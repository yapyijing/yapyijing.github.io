// IDs for folders (F-XXXXXX) and documents (D-XXXXXX), shared by the site and the vault API.
//
// X is A–Z or 0–9 without I and O. The vault API gives each new item an ID and keeps it through
// renames and moves (rules and grants hang on it), so links like …/#D-7F3K9Q keep working.

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const te = new TextEncoder();

export const ID_PATTERN = /^[FD]-[0-9A-HJ-NP-Z]{6}$/;

/** The ID a new item gets: 'F' for a folder, 'D' for a document, from a hash of its path. Skips any ID in `taken`. */
export async function makeId(kind, path, taken = new Set()) {
  for (let n = 0; ; n++) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', te.encode(`vault-id:${kind}:${path}:${n}`)));
    let x = 0n;
    for (const b of digest.subarray(0, 8)) x = (x << 8n) | BigInt(b);
    let body = '';
    for (let i = 0; i < 6; i++) {
      body += ALPHABET[Number(x % 34n)];
      x /= 34n;
    }
    const id = `${kind}-${body}`;
    if (!taken.has(id)) return id;
  }
}

/** Read what someone typed as an ID: "d 7f3k9q", "D7F3K9Q" and "D-7F3K9O" all work. */
export function parseId(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  const m = s.match(/^([FD])([0-9A-Z]{6})$/);
  if (!m) return null;
  const id = `${m[1]}-${m[2].replace(/O/g, '0').replace(/I/g, '1')}`;
  return ID_PATTERN.test(id) ? id : null;
}
