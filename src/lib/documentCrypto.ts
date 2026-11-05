import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/config/env";

// PB-002. Cifrado de sobre (envelope) con AES-256-GCM: cada archivo usa su
// propia clave aleatoria (DEK); la DEK se guarda en la BD cifrada con
// DOCUMENTS_MASTER_KEY. Rotar la maestra = re-envolver DEKs, no re-subir
// archivos. GCM además detecta cualquier byte alterado en S3 (authTag).
// ponytail: maestra en .env; pasar a AWS KMS (GenerateDataKey/Decrypt) si
// cumplimiento pide custodia/auditoría de la clave — wrapKey/unwrapKey son
// el único punto a cambiar.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedFile {
  ciphertext: Buffer;
  /** IV(12) + DEK cifrada(32) + authTag(16) */
  wrappedKey: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function masterKey(source = env.documentsMasterKey): Buffer {
  const key = Buffer.from(source, "base64");
  if (key.length !== 32) {
    throw new Error("DOCUMENTS_MASTER_KEY must be 32 bytes encoded in base64");
  }
  return key;
}

function seal(key: Buffer, plaintext: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, authTag: cipher.getAuthTag() };
}

function open(key: Buffer, iv: Buffer, ciphertext: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptFile(plaintext: Buffer, master = masterKey()): EncryptedFile {
  const dek = randomBytes(32);
  const file = seal(dek, plaintext);
  const wrapped = seal(master, dek);
  return {
    ciphertext: file.ciphertext,
    iv: file.iv,
    authTag: file.authTag,
    wrappedKey: Buffer.concat([wrapped.iv, wrapped.ciphertext, wrapped.authTag]),
  };
}

/** Lanza si el archivo, la DEK o la maestra no coinciden (archivo alterado). */
export function decryptFile(encrypted: EncryptedFile, master = masterKey()): Buffer {
  const { wrappedKey } = encrypted;
  const dek = open(
    master,
    wrappedKey.subarray(0, IV_BYTES),
    wrappedKey.subarray(IV_BYTES, wrappedKey.length - TAG_BYTES),
    wrappedKey.subarray(wrappedKey.length - TAG_BYTES),
  );
  return open(dek, encrypted.iv, encrypted.ciphertext, encrypted.authTag);
}
