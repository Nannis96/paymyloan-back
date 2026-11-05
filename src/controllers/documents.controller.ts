import { z } from "zod";
import { AppError } from "@/errors/AppError";
import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as documentsService from "@/services/documents.service";
import type { DocumentParent } from "@/services/documents.service";

// PB-002. Subir/borrar: LENDER y BORROWER (escritura de LENDER exige 2FA,
// D-P3-1). Leer: también ADMIN, sin 2FA.
async function requireWriteSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER"]);
  return session;
}

async function requireReadSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER", "ADMIN"], { requireTwoFactor: false });
  return session;
}

// Un id mal formado nunca existe: 404 en vez de que Postgres rechace el uuid con un 500.
function requireUuid(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new AppError("Not found", 404, "NOT_FOUND");
  return id;
}

function parent(kind: "contract" | "loanRequest", id: string): DocumentParent {
  return kind === "contract" ? { contractId: requireUuid(id) } : { loanRequestId: requireUuid(id) };
}

export async function uploadDocuments(request: Request, kind: "contract" | "loanRequest", id: string, files: File[]) {
  const session = await requireWriteSession(request);
  return documentsService.uploadDocuments(session, parent(kind, id), files);
}

export async function listDocuments(request: Request, kind: "contract" | "loanRequest", id: string) {
  const session = await requireReadSession(request);
  return documentsService.listDocuments(session, parent(kind, id));
}

export async function getDocumentContent(request: Request, id: string) {
  const session = await requireReadSession(request);
  return documentsService.getDocumentContent(session, requireUuid(id));
}

export async function deleteDocument(request: Request, id: string) {
  const session = await requireWriteSession(request);
  await documentsService.deleteDocument(session, requireUuid(id));
}
