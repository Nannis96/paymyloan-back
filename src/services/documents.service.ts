import { randomUUID } from "node:crypto";
import type { Document, Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { decryptFile, encryptFile, type EncryptedFile } from "@/lib/documentCrypto";
import { deleteObject, getObject, putObject } from "@/lib/s3";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import type { Session } from "@/middlewares/withAuth";

// PB-002. Documentos e imágenes cifrados (documentCrypto.ts) en S3, colgados
// de un Contract o de un LoanRequest. Suben LENDER y BORROWER con acceso al
// padre; leen además el ADMIN; borra solo quien subió.

export const MAX_FILES_PER_UPLOAD = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type DocumentParent = { contractId: string } | { loanRequestId: string };

const metadataSelect = {
  id: true,
  contractId: true,
  loanRequestId: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedByUserId: true,
  createdAt: true,
} as const;

// Tipo real por los primeros bytes — nunca el Content-Type que manda el
// cliente. Lo que no matchea se rechaza.
export function detectMimeType(bytes: Buffer): string | null {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString("latin1");
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  // Fotos de iPhone.
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "heim", "heis", "mif1"].includes(ascii(8, 12))) return "image/heic";
  return null;
}

export function sanitizeFileName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 255);
  return clean || "file";
}

// LoanRequest: el Borrower dueño; un Lender cuyo contrato nació de ella o a
// quien va dirigida (PUBLISHED + target activo); el Admin siempre. Un Lender
// que solo la ve por ser PUBLIC en el marketplace puede leer pero no subir
// (403). 404 en cualquier otro caso (anti-enumeración, §7.5).
async function requireLoanRequestAccess(session: Session, loanRequestId: string, forWrite: boolean) {
  const loanRequest = await prisma.loanRequest.findUnique({
    where: { id: loanRequestId },
    include: { targets: { where: { removedAt: null } }, contract: { select: { lenderCompanyId: true, deletedAt: true } } },
  });
  if (!loanRequest) throw new AppError("Loan request not found", 404, "NOT_FOUND");
  if (session.roles.includes("ADMIN")) return loanRequest;

  if (session.roles.includes("BORROWER")) {
    const profile = await prisma.borrowerProfile.findUnique({ where: { userId: session.userId } });
    if (profile && profile.id === loanRequest.borrowerProfileId) return loanRequest;
  }

  if (session.roles.includes("LENDER")) {
    const companies = await prisma.lenderCompany.findMany({
      where: { lenderProfile: { userId: session.userId }, deletedAt: null },
      select: { id: true },
    });
    const ids = companies.map((company) => company.id);
    const ownsContract = loanRequest.contract && !loanRequest.contract.deletedAt && ids.includes(loanRequest.contract.lenderCompanyId);
    const published = loanRequest.status === "PUBLISHED";
    const targeted = published && loanRequest.targets.some((target) => ids.includes(target.lenderCompanyId));
    if (ownsContract || targeted) return loanRequest;
    if (published && loanRequest.visibility === "PUBLIC") {
      if (forWrite) throw new AppError("Lenders can only view documents of a public loan request", 403, "FORBIDDEN");
      return loanRequest;
    }
  }

  throw new AppError("Loan request not found", 404, "NOT_FOUND");
}

async function requireParentAccess(
  session: Session,
  parent: { contractId: string | null; loanRequestId: string | null },
  forWrite = false,
) {
  if (parent.contractId) {
    await requireContractAccess(session, parent.contractId);
  } else if (parent.loanRequestId) {
    await requireLoanRequestAccess(session, parent.loanRequestId, forWrite);
  }
}

function toParentColumns(parent: DocumentParent) {
  return "contractId" in parent
    ? { contractId: parent.contractId, loanRequestId: null }
    : { contractId: null, loanRequestId: parent.loanRequestId };
}

export interface PreparedDocument {
  id: string;
  s3Key: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  encrypted: EncryptedFile;
}

export type DocumentMeta = Prisma.DocumentGetPayload<{ select: typeof metadataSelect }>;

// Paso 1 (antes de tocar S3 o la BD): valida y cifra. Un archivo inválido
// corta todo el lote con 400. Acepta 0 archivos (las creaciones de
// contrato/loan request los tienen opcionales).
export async function prepareDocuments(files: File[]): Promise<PreparedDocument[]> {
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new AppError(`At most ${MAX_FILES_PER_UPLOAD} files per upload`, 400, "VALIDATION_ERROR");
  }
  return Promise.all(
    files.map(async (file) => {
      if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        throw new AppError(`File '${file.name}' must be between 1 byte and ${MAX_FILE_BYTES / 1024 / 1024} MB`, 400, "FILE_TOO_LARGE");
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = detectMimeType(bytes);
      if (!mimeType) {
        throw new AppError(`File '${file.name}' must be a PDF, JPEG, PNG, WEBP or HEIC`, 400, "UNSUPPORTED_FILE_TYPE");
      }
      const id = randomUUID();
      // Sin carpeta del padre: al crear contrato/loan request con archivos,
      // el padre todavía no existe cuando se sube.
      return { id, s3Key: `documents/${id}`, originalFileName: sanitizeFileName(file.name), mimeType, sizeBytes: bytes.length, encrypted: encryptFile(bytes) };
    }),
  );
}

const discard = (prepared: PreparedDocument[]) => Promise.allSettled(prepared.map((doc) => deleteObject(doc.s3Key)));

// Paso 2: sube a S3 y después corre `persist` (que crea las filas — en la
// misma transacción que el padre, si lo hay). Si falla la subida o
// `persist`, borra de S3 lo subido: el lote es todo o nada.
export async function withStoredDocuments<T>(prepared: PreparedDocument[], persist: () => Promise<T>): Promise<T> {
  const uploads = await Promise.allSettled(prepared.map((doc) => putObject(doc.s3Key, doc.encrypted.ciphertext)));
  const failed = uploads.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    await discard(prepared.filter((_, i) => uploads[i].status === "fulfilled"));
    throw new AppError(`Could not store the files: ${String(failed.reason)}`, 502, "STORAGE_ERROR");
  }
  try {
    return await persist();
  } catch (error) {
    await discard(prepared);
    throw error;
  }
}

export async function createDocumentRows(
  tx: Prisma.TransactionClient,
  prepared: PreparedDocument[],
  parent: DocumentParent,
  uploadedByUserId: string,
): Promise<DocumentMeta[]> {
  if (prepared.length === 0) return [];
  return tx.document.createManyAndReturn({
    data: prepared.map(({ encrypted, ...doc }) => ({
      ...doc,
      ...toParentColumns(parent),
      wrappedKey: new Uint8Array(encrypted.wrappedKey),
      iv: new Uint8Array(encrypted.iv),
      authTag: new Uint8Array(encrypted.authTag),
      uploadedByUserId,
    })),
    select: metadataSelect,
  });
}

export async function auditDocumentsUploaded(actorUserId: string, documents: DocumentMeta[]): Promise<void> {
  await Promise.all(
    documents.map((doc) =>
      logAuditEvent({
        action: "DOCUMENT_UPLOADED",
        entityType: "Document",
        entityId: doc.id,
        actorUserId,
        contractId: doc.contractId ?? undefined,
        metadata: { loanRequestId: doc.loanRequestId, fileName: doc.originalFileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
      }),
    ),
  );
}

export async function uploadDocuments(session: Session, parent: DocumentParent, files: File[]) {
  await requireParentAccess(session, toParentColumns(parent), true);
  if (files.length === 0) throw new AppError("At least one file is required in field 'files'", 400, "VALIDATION_ERROR");

  const prepared = await prepareDocuments(files);
  const created = await withStoredDocuments(prepared, () =>
    prisma.$transaction((tx) => createDocumentRows(tx, prepared, parent, session.userId)),
  );
  await auditDocumentsUploaded(session.userId, created);
  return created;
}

export async function listDocuments(session: Session, parent: DocumentParent) {
  const columns = toParentColumns(parent);
  await requireParentAccess(session, columns);
  return prisma.document.findMany({
    where: "contractId" in parent ? { contractId: parent.contractId } : { loanRequestId: parent.loanRequestId },
    select: metadataSelect,
    orderBy: { createdAt: "desc" },
  });
}

async function requireDocument(session: Session, documentId: string): Promise<Document> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new AppError("Document not found", 404, "NOT_FOUND");
  try {
    await requireParentAccess(session, document);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) throw new AppError("Document not found", 404, "NOT_FOUND");
    throw error;
  }
  return document;
}

export async function getDocumentContent(session: Session, documentId: string) {
  const document = await requireDocument(session, documentId);
  const ciphertext = await getObject(document.s3Key);
  let body: Buffer;
  try {
    body = decryptFile({
      ciphertext,
      wrappedKey: Buffer.from(document.wrappedKey),
      iv: Buffer.from(document.iv),
      authTag: Buffer.from(document.authTag),
    });
  } catch {
    throw new AppError("Document could not be decrypted", 500, "DOCUMENT_CORRUPTED");
  }
  return { body, mimeType: document.mimeType, fileName: document.originalFileName };
}

export async function deleteDocument(session: Session, documentId: string): Promise<void> {
  const document = await requireDocument(session, documentId);
  if (document.uploadedByUserId !== session.userId) {
    throw new AppError("Only the user who uploaded this document can delete it", 403, "FORBIDDEN");
  }
  // S3 primero: si falla, la fila sigue y se puede reintentar (DeleteObject es idempotente).
  await deleteObject(document.s3Key);
  await prisma.document.delete({ where: { id: documentId } });
  await logAuditEvent({
    action: "DOCUMENT_DELETED",
    entityType: "Document",
    entityId: documentId,
    actorUserId: session.userId,
    contractId: document.contractId ?? undefined,
    metadata: { loanRequestId: document.loanRequestId, fileName: document.originalFileName },
  });
}
