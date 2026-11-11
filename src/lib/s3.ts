import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/config/env";
import { AppError } from "@/errors/AppError";
import { logger } from "@/lib/logger";

// PB-002. Bucket privado; los objetos ya llegan cifrados por la app
// (documentCrypto.ts) — S3 nunca ve el contenido en claro. Se pide además
// SSE-S3 como segunda capa (gratis, ya es el default del bucket).
const client = new S3Client({ region: env.awsRegion });

// Un error de AWS nunca sale tal cual al cliente: puede traer ARNs, nombres
// de usuario IAM o del bucket. El detalle real queda en el log del servidor;
// el cliente recibe un AppError con el formato del resto de la API.
async function run<T>(operation: "put" | "get" | "delete", key: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const notFound = operation === "get" && (name === "NoSuchKey" || name === "NotFound");
    logger[notFound ? "warn" : "error"]("S3 operation failed", {
      operation,
      key,
      errorName: name,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (notFound) throw new AppError("Document not found", 404, "NOT_FOUND");
    throw new AppError("Document storage is temporarily unavailable, please try again later", 502, "STORAGE_ERROR");
  }
}

export function putObject(key: string, body: Buffer): Promise<void> {
  return run("put", key, async () => {
    await client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
      }),
    );
  });
}

export function getObject(key: string): Promise<Buffer> {
  return run("get", key, async () => {
    const result = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    if (!result.Body) throw new Error(`Empty S3 object: ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  });
}

/** Idempotente: borrar una key que ya no existe no falla. */
export function deleteObject(key: string): Promise<void> {
  return run("delete", key, async () => {
    await client.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  });
}
