// Canonical JSON and SHA-256 helpers. Standard algorithms only, no dependencies.
// Runs unchanged in Node (>= 20) and in browsers: it uses the global WebCrypto.

/**
 * Stable stringify: object keys sorted recursively, arrays in order, scalars via
 * JSON.stringify. This is exactly how FundQuill serializes a section before it
 * hashes it, so the same section always hashes the same, whatever its key order.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 (hex) of raw bytes. */
export async function sha256Bytes(bytes) {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

/** SHA-256 (hex) of a string's UTF-8 bytes. */
export async function sha256Text(text) {
  return sha256Bytes(new TextEncoder().encode(text));
}

/** Decode base64url (padding optional, whitespace ignored). Throws on bad input. */
export function b64urlToBytes(s) {
  const clean = String(s).replace(/\s+/g, '');
  const pad = '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(clean.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
