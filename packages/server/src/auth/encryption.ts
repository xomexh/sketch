/**
 * AES-256-GCM encryption helpers for storing sensitive credentials at rest.
 * The hex key must be 64 hex characters (32 bytes). Ciphertext is self-describing:
 * `enc:<iv_b64>:<auth_tag_b64>:<ciphertext_b64>` so it can be detected and decrypted
 * without out-of-band metadata.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Encrypts a plaintext string with AES-256-GCM and returns a self-describing ciphertext string. */
export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts a ciphertext produced by {@link encrypt}.
 * Returns the original string unchanged if it does not start with `enc:` (plaintext pass-through).
 */
export function decrypt(ciphertext: string, hexKey: string): string {
  if (!ciphertext.startsWith("enc:")) return ciphertext;
  const [, ivB64, tagB64, dataB64] = ciphertext.split(":");
  const key = Buffer.from(hexKey, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
