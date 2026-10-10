import { idbGet, idbSet } from "./idb.js";

/**
 * Encryption at rest for API keys.
 * A non-extractable AES-GCM key is generated once and kept in IndexedDB;
 * only ciphertext is ever written to persistent storage. The key never
 * leaves the browser, so exports/backups contain encrypted keys only.
 *
 * If WebCrypto is unavailable (a non-localhost http:// origin is NOT a
 * secure context, so `crypto.subtle` is undefined there) encryption FAILS
 * LOUDLY. It must never silently fall back to writing plaintext secrets
 * while the UI claims they are encrypted.
 */

const KEY_ID = "app-enc-key";
let cachedKey = null;

export class CryptoUnavailable extends Error {
  constructor() {
    super("WebCrypto is unavailable — open the app over https:// or http://localhost to store API keys.");
    this.name = "CryptoUnavailable";
  }
}

export const cryptoAvailable = () => typeof crypto !== "undefined" && !!crypto?.subtle;

async function getKey() {
  if (cachedKey) return cachedKey;
  if (!cryptoAvailable()) throw new CryptoUnavailable();
  const stored = await idbGet(KEY_ID);
  if (stored) {
    cachedKey = stored;
    return stored;
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbSet(KEY_ID, key);
  cachedKey = key;
  return key;
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export const isEncrypted = (v) => typeof v === "string" && v.startsWith("enc:v1:");

/** Encrypt a secret. Throws CryptoUnavailable rather than returning plaintext. */
export async function encryptText(plain) {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptText(stored) {
  if (!isEncrypted(stored)) return stored;
  try {
    const [, , ivB64, ctB64] = String(stored).split(":");
    const key = await getKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return ""; // wrong device / missing key — never expose ciphertext
  }
}
