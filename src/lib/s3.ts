import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/config/env";

// PB-002. Bucket privado; los objetos ya llegan cifrados por la app
// (documentCrypto.ts) — S3 nunca ve el contenido en claro. Se pide además
// SSE-S3 como segunda capa (gratis, ya es el default del bucket).
const client = new S3Client({ region: env.awsRegion });

export async function putObject(key: string, body: Buffer): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
      ServerSideEncryption: "AES256",
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const result = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  if (!result.Body) throw new Error(`Empty S3 object: ${key}`);
  return Buffer.from(await result.Body.transformToByteArray());
}

/** Idempotente: borrar una key que ya no existe no falla. */
export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}
