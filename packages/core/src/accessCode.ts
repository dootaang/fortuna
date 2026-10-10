import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Crockford base32 without ambiguous I/L/O/U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** FRT-XXXX-XXXX-XXXX: 60 random bits. */
export function generateAccessCode(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const chars = [...bytes].map((byte) => ALPHABET[byte % 32]).join("");
  return `FRT-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Uppercase, map look-alikes, strip separators, re-insert dashes. */
export function normalizeAccessCode(input: string): string {
  let raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (raw.length === 15 && raw.startsWith("FRT")) raw = raw.slice(3);
  raw = raw.replace(/O/g, "0").replace(/[IL]/g, "1");
  return raw.length === 12 ? `FRT-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}` : input.trim().toUpperCase();
}

/** Document id under accessCodes/. The code itself is never stored. */
export function accessCodeHash(code: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`fortuna-access:${normalizeAccessCode(code)}`)));
}
