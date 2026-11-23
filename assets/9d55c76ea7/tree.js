// Folder tree and path helpers.

export function buildTree(files, extraDirs = []) {
  const root = makeDir('', '');
  const ensure = (segs) => {
    let n = root;
    for (const s of segs) {
      if (!n.dirs.has(s)) n.dirs.set(s, makeDir(s, joinPath(n.path, s)));
      n = n.dirs.get(s);
    }
    return n;
  };
  for (const d of extraDirs) if (d) ensure(d.split('/'));
  for (const f of files) {
    const segs = f.p.split('/');
    const name = segs.pop();
    ensure(segs).files.set(name, { ...f, name });
  }
  return root;
}

function makeDir(name, path) {
  return { name, path, dirs: new Map(), files: new Map() };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
export const sortedDirs = (n) => [...n.dirs.values()].sort(byName);
export const sortedFiles = (n) => [...n.files.values()].sort(byName);

// Exact match first, then a unique case-insensitive match.
function lookup(map, s) {
  if (map.has(s)) return map.get(s);
  const l = s.toLowerCase();
  let hit = null;
  for (const [k, v] of map) {
    if (k.toLowerCase() === l) {
      if (hit) return null;
      hit = v;
    }
  }
  return hit;
}

/** Returns { kind: 'dir', node, path } or { kind: 'file', file, path }, or null. */
export function findNode(root, path) {
  if (!path) return { kind: 'dir', node: root, path: '' };
  const segs = path.split('/');
  let n = root;
  for (let i = 0; i < segs.length; i++) {
    const d = lookup(n.dirs, segs[i]);
    if (d) {
      n = d;
      continue;
    }
    if (i === segs.length - 1) {
      const f = lookup(n.files, segs[i]);
      if (f) return { kind: 'file', file: f, path: f.p };
    }
    return null;
  }
  return { kind: 'dir', node: n, path: n.path };
}

/** Resolve user input (absolute, relative, with ./.. or a habitual prefix) to a path without slashes at either end. */
export function normalisePath(input, cwd = '', aliases = []) {
  let s = String(input || '').trim().replace(/\\/g, '/');
  if (s.startsWith('~')) s = s.slice(1);
  let absolute = s.startsWith('/');
  s = s.replace(/^\/+/, '');
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    const lower = s.toLowerCase();
    if (lower.startsWith(a) || lower === a.replace(/\/$/, '')) {
      s = s.slice(alias.length);
      absolute = true;
      break;
    }
  }
  const parts = absolute || !cwd ? [] : cwd.split('/');
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Give each folder node its F- ID from a { path: id } map (files carry theirs as `i`). */
export function setDirIds(root, map = {}) {
  const rec = (n) => {
    n.id = map[n.path] || null;
    for (const d of n.dirs.values()) rec(d);
  };
  rec(root);
}

/** Find a folder (F-…) or document (D-…) by ID. Same result shape as findNode, or null. */
export function findById(root, id) {
  let hit = null;
  const rec = (n) => {
    if (hit) return;
    if (id[0] === 'F' && n.id === id) hit = { kind: 'dir', node: n, path: n.path };
    if (id[0] === 'D') for (const f of n.files.values()) if (f.i === id) hit = { kind: 'file', file: f, path: f.p };
    for (const d of n.dirs.values()) rec(d);
  };
  rec(root);
  return hit;
}

export function walkFiles(node) {
  const out = [];
  const rec = (n) => {
    for (const f of sortedFiles(n)) out.push(f);
    for (const d of sortedDirs(n)) rec(d);
  };
  rec(node);
  return out;
}

export function countFiles(node) {
  let c = node.files.size;
  for (const d of node.dirs.values()) c += countFiles(d);
  return c;
}

export function formatSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** e.g. "18 Nov 2026, 3:05 pm" */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function unquote(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(["'])(.*)\1$/);
  return m ? m[2] : t;
}

export const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);

export function tokenize(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export const basename = (p) => p.split('/').pop();
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const joinPath = (a, b) => (a && b ? `${a}/${b}` : a || b);

function commonPrefix(list) {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) {
    let i = 0;
    while (i < p.length && i < s.length && p[i].toLowerCase() === s[i].toLowerCase()) i++;
    p = p.slice(0, i);
  }
  return p;
}

/** Tab completion for "/command <path>" lines. Returns { value, options } or null. */
export function completeLine(line, { commands, root, cwd, aliases }) {
  const cmdOnly = line.match(/^\/?(\S*)$/);
  if (cmdOnly) {
    const pre = cmdOnly[1].toLowerCase();
    const opts = commands.filter((c) => c.startsWith(pre)).sort();
    if (opts.length === 1) return { value: `/${opts[0]} ` };
    if (opts.length > 1) return { value: `/${commonPrefix(opts)}`, options: opts.map((o) => '/' + o) };
    return null;
  }
  if (!root) return null;
  const m = line.match(/^(\/?\S+\s+)([\s\S]*)$/);
  if (!m) return null;
  const arg = m[2];
  // Complete only the last path: after "-> " or after an unclosed quote, else the whole argument.
  let start = 0;
  const arrow = arg.lastIndexOf('-> ');
  if (arrow >= 0) start = arrow + 3;
  const quotes = [...arg.matchAll(/"/g)].map((q) => q.index);
  if (quotes.length % 2 === 1) start = Math.max(start, quotes[quotes.length - 1] + 1);
  const partial = arg.slice(start);
  const slash = partial.lastIndexOf('/');
  const dirPart = partial.slice(0, slash + 1);
  const base = partial.slice(slash + 1).toLowerCase();
  const dir = findNode(root, normalisePath(dirPart, cwd, aliases));
  if (!dir || dir.kind !== 'dir') return null;
  const opts = [
    ...sortedDirs(dir.node).map((d) => d.name + '/'),
    ...sortedFiles(dir.node).map((f) => f.name),
  ].filter((n) => n.toLowerCase().startsWith(base));
  if (!opts.length) return null;
  const head = m[1] + arg.slice(0, start) + dirPart;
  if (opts.length === 1) return { value: head + opts[0] };
  return { value: head + commonPrefix(opts), options: opts };
}
