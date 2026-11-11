import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/errors/AppError";
import { deleteObject, getObject, putObject } from "@/lib/s3";

// Los errores del SDK de AWS nunca deben llegar al cliente: se traducen a
// AppError con el formato del proyecto y el detalle queda solo en el log.
function awsError(name: string, message: string) {
  return Object.assign(new Error(message), { name });
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("s3 — errores de AWS homologados (PB-002)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("credenciales o permisos fallidos → 502 STORAGE_ERROR genérico; el detalle va solo al log", async () => {
    const leak = "User: arn:aws:iam::123456789012:user/dev is not authorized to perform: s3:PutObject";
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(awsError("AccessDenied", leak) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const call of [putObject("documents/a", Buffer.from("x")), getObject("documents/a"), deleteObject("documents/a")]) {
      const error = await caught(call);
      expect(error).toMatchObject({ statusCode: 502, code: "STORAGE_ERROR" });
      expect(error.message).not.toMatch(/arn:|AccessDenied|s3:/);
    }
    expect(log.mock.calls.flat().join(" ")).toContain("AccessDenied");

    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(awsError("CredentialsProviderError", "Could not load credentials from any providers") as never);
    const noCredentials = await caught(putObject("documents/a", Buffer.from("x")));
    expect(noCredentials).toMatchObject({ statusCode: 502, code: "STORAGE_ERROR" });
    expect(noCredentials.message).not.toMatch(/credentials/i);
  });

  it("objeto inexistente al leer → 404 NOT_FOUND", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(awsError("NoSuchKey", "The specified key does not exist.") as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await caught(getObject("documents/missing"))).toMatchObject({ statusCode: 404, code: "NOT_FOUND", message: "Document not found" });
  });
});
