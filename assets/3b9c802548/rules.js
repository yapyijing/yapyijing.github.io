// Lock and Hide rules, shared by the vault API (which enforces them) and the admin console.
//
//   Lock: users see the name, but only keys granted that lock can open it.
//   Hide: left out of the site entirely, except for keys granted that hide.
//
//   Open: a file or folder inside a locked folder that every key may open anyway. It lifts the Locks
//         around it (not Hide); a Lock set further inside it still applies.
//   No download: users can preview it but not download it, on its own or inside a folder .zip.
//                Independent of Lock and Hide (and of grants).
//
// The API stores rules and grants on item IDs and turns them into paths for these functions:
// rules = { locked, hidden, nodownload, opened: [paths] }; grants = the paths a key may open.

/** True when `path` is `root` itself or lies inside it. */
export const covers = (root, path) => path === root || path.startsWith(root + '/');

const cleanPath = (p) => String(p).replace(/^\/+|\/+$/g, '');

/** Read either the v1 ({ locked }) or v2 ({ locked, hidden, nodownload }) format. */
export function normaliseRules(doc) {
  const list = (a) => [...new Set((Array.isArray(a) ? a : []).map(cleanPath).filter(Boolean))].sort();
  const hidden = list(doc?.hidden);
  // Hide wins over Lock on the same path.
  const locked = list(doc?.locked).filter((p) => !hidden.includes(p));
  // An opening only means something strictly inside a Lock, and never on a locked or hidden item itself.
  const opened = list(doc?.opened).filter((p) => !hidden.includes(p) && !locked.includes(p) && locked.some((l) => covers(l, p)));
  return { locked, hidden, nodownload: list(doc?.nodownload), opened };
}

/** The Locks that still apply to `path`: a Lock is lifted for everything inside an opening within it. */
export const liveLocks = (rules, path) => rules.locked.filter((l) => covers(l, path)
  && !(rules.opened || []).some((o) => o !== l && covers(l, o) && covers(o, path)));

/** The opening that makes `path` open despite a Lock around it (the innermost one), or undefined. */
export const openedBy = (rules, path) => (rules.opened || [])
  .filter((o) => covers(o, path) && rules.locked.some((l) => l !== o && covers(l, o)))
  .sort((a, b) => b.length - a.length)[0];

/** True when downloading is turned off for `path` (by itself or a folder around it). */
export const isNoDownload = (rules, path) => rules.nodownload.some((r) => covers(r, path));

/** Every rule that applies to `path`, outermost first. */
export function rulesFor(rules, path) {
  return [
    ...liveLocks(rules, path).map((r) => ({ kind: 'lock', path: r })),
    ...rules.hidden.filter((r) => covers(r, path)).map((r) => ({ kind: 'hide', path: r })),
  ].sort((a, b) => a.path.length - b.path.length);
}

export const isHiddenPath = (rules, path) => rules.hidden.some((r) => covers(r, path));

/**
 * Whether a key with these grants may open `path`.
 * Each rule over the path needs a grant at or inside that rule which still covers the path,
 * so a hidden folder inside a granted locked folder stays hidden until it is granted too.
 */
export function canOpen(rules, grants = [], path) {
  return rulesFor(rules, path).every((r) => grants.some((g) => covers(r.path, g) && covers(g, path)));
}
