import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptFile, encryptFile } from "@/lib/documentCrypto";

describe("documentCrypto (PB-002)", () => {
  it("cifra y descifra; el texto cifrado no contiene el original y cada archivo usa clave/IV propios", () => {
    const plain = Buffer.from("%PDF-1.7 contenido confidencial del préstamo");
    const a = encryptFile(plain);
    const b = encryptFile(plain);

    expect(decryptFile(a)).toEqual(plain);
    expect(a.ciphertext.includes(Buffer.from("confidencial"))).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it("rechaza un archivo alterado en S3, una clave envuelta alterada o otra maestra", () => {
    const encrypted = encryptFile(randomBytes(1024));

    const tamperedFile = Buffer.from(encrypted.ciphertext);
    tamperedFile[10] ^= 0xff;
    expect(() => decryptFile({ ...encrypted, ciphertext: tamperedFile })).toThrow();

    const tamperedKey = Buffer.from(encrypted.wrappedKey);
    tamperedKey[20] ^= 0xff;
    expect(() => decryptFile({ ...encrypted, wrappedKey: tamperedKey })).toThrow();

    expect(() => decryptFile(encrypted, randomBytes(32))).toThrow();
  });
});
