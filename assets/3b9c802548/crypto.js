// Access-key and byte helpers shared by the site, the vault API (Worker) and the Mac scripts.

// A–Z and 0–9 without I and O (they look like 1 and 0): 34 symbols, about 81 bits per key.
const KEY_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A new access key such as 7F3K-Q9XA-M2PD-8HVT. */
export function generateKey() {
  let body = '';
  while (body.length < 16) {
    for (const b of randomBytes(32)) {
      // Rejection sampling keeps every symbol equally likely (238 = 7 × 34).
      if (b < 238 && body.length < 16) body += KEY_ALPHABET[b % 34];
    }
  }
  return body.match(/.{4}/g).join('-');
}

/** Upper-case, strip dashes and spaces, and read a typed O or I as 0 or 1. */
export function normaliseKey(input) {
  let s = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  // Older keys were written as NOTE-XXXX-XXXX-XXXX-XXXX.
  if (s.length === 20 && s.startsWith('NOTE')) s = s.slice(4);
  return s.replace(/O/g, '0').replace(/I/g, '1');
}

export function isPlausibleKey(norm) {
  return /^[0-9A-HJ-NP-Z]{16}$/.test(norm);
}
