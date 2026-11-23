// File browser:
// folder tree, breadcrumbs, file list, search results and the preview panel.
import { h, icon, btn, typeIcon, toast, popMenu, noAccessDialog, copyText } from './ui.js';
import { parseId } from './ids.js';
import { Viewer, saveBytes, zipFiles, extOf } from './viewer.js';
import { findNode, findById, sortedDirs, sortedFiles, walkFiles, countFiles, formatSize, formatDate, dirname } from './tree.js';

export class NotesBrowser {
  /**
   * opts: {
   *   readFile(file): Promise<Uint8Array>
   *   searchText?(): Promise<Record<path, text>>   – enables full-text search in the browser
   *   searchContent?(query): Promise<[{ p, snip }]> – or: full-text search done by the server
   *   rowMenu?(item, isDir): [{ label, icon, onClick, danger }]
   *   toolbar?(path): Node[]                        – extra buttons for the current folder
   *   onDropFiles?(path, files)                     – enables drag-and-drop upload
   *   tag?(path, isDir, item): 'lock'|'hide'|null   – padlock or "hidden" mark on a folder or file
   *   badge?(path, item): Node|null                 – an extra clickable mark on a folder row (admin warnings)
   *   isBlocked?(file): boolean                     – this file cannot be opened (public site)
   *   canDownload?(file): boolean                   – Download works for this file (default: yes);
   *                                                   if not, the button is greyed out and explains why
   *   owner?: string, contact?(): string            – named in the "no access" popups
   *   onLocked?(file): boolean                      – handles a click on a locked file (e.g. asks for a PIN); true = handled
   *   askAssistant?(fileId, messages): Promise<{ text }> – shows the AI assistant in the preview
   *   rootLabel?: string                             – name of the top level (default 'All files')
   *   zipName?: string                               – file name stem for 'Download all' (default 'jings-vault')
   *   showIds?: boolean                              – grey F-/D- ID labels (default true)
   * }
   * Folders can always be opened, so users see the full structure of a locked folder.
   */
  constructor(mount, opts) {
    this.opts = opts;
    this.root = null;
    this.path = '';
    this.query = '';
    this.searchTok = 0;
    this.expanded = new Set();

    this.treeEl = h('nav', { class: 'tree', 'aria-label': 'Folders' });
    this.side = h('aside', { class: 'sidebar' }, this.treeEl);
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    this.tools = h('div', { class: 'tools' });
    this.listEl = h('div', { class: 'list' });
    const sideToggle = btn('Folders', () => this.el.classList.toggle('side-open'), { kind: 'icon', iconName: 'menu' });
    sideToggle.classList.add('side-toggle');
    this.main = h('section', { class: 'main' },
      h('div', { class: 'bar' }, sideToggle, this.crumbs, this.tools),
      this.listEl,
    );
    this.pv = h('section', { class: 'preview', hidden: true, 'aria-label': 'Preview' });
    this.el = h('div', { class: 'browser' },
      this.side,
      h('div', { class: 'scrim', onclick: () => this.el.classList.remove('side-open') }),
      this.main,
      this.pv,
    );
    this.viewer = new Viewer(this.pv, {
      ask: opts.askAssistant,
      onOpen: () => this.el.classList.add('has-preview'),
      onClose: () => {
        this.el.classList.remove('has-preview');
        this.#markActive();
      },
    });
    this.viewer.idChip = opts.showIds === false ? null : idChip;
    this.rootLabel = opts.rootLabel || 'All files';
    if (opts.onDropFiles) this.#enableDrop();
    mount.append(this.el);
  }

  setTree(root) {
    this.root = root;
    const n = findNode(root, this.path);
    if (!n || n.kind !== 'dir') this.path = '';
    this.render();
  }

  go(path) {
    this.query = '';
    this.searchTok++;
    this.path = path;
    // Open every ancestor in the tree.
    let p = path;
    while (p) {
      this.expanded.add(p);
      p = dirname(p);
    }
    this.el.classList.remove('side-open');
    this.onNavigate?.();
    this.render();
  }

  render() {
    if (!this.root) return;
    this.#renderTree();
    this.#renderBar();
    if (this.query) this.#renderSearch();
    else this.#renderList();
  }

  // ---------- Locks ----------

  #tag(p, isDir, item) {
    return p ? this.opts.tag?.(p, isDir, item) || null : null;
  }

  #blocked(f) {
    return !!this.opts.isBlocked?.(f);
  }

  #savable(f) {
    return !this.#blocked(f) && (this.opts.canDownload?.(f) ?? true);
  }

  #tagEl(kind) {
    if (!kind) return null;
    if (kind === 'hide') return h('span', { class: 'lock-tag hide', title: 'Hidden from users' }, icon('eye-off', 13));
    return h('span', { class: 'lock-tag', title: 'Locked' }, icon('lock', 13));
  }

  /** The Lock / Hide mark (no mark = open). Rows can add a clickable badge; the folder tree cannot (it is a button itself). */
  #tags(p, isDir, item, { row = false } = {}) {
    if (!p) return [];
    const badge = row && isDir ? this.opts.badge?.(p, item) : null;
    return [this.#tagEl(this.#tag(p, isDir, item)), badge].filter(Boolean);
  }

  /** A Download button; greyed out (but still explaining itself when pressed) when downloading is not allowed. */
  #downloadButton(label, onClick, allowed, offMessage, kind) {
    const b = btn(label, allowed ? onClick : offMessage, { kind, iconName: 'download', title: allowed ? null : 'Disabled for download' });
    if (!allowed) {
      b.classList.add('off');
      b.setAttribute('aria-disabled', 'true');
    }
    return b;
  }

  #showLocked(f) {
    if (this.opts.onLocked?.(f)) return;
    noAccessDialog({ kind: 'open', name: f.name, owner: this.opts.owner, contact: this.opts.contact?.() });
  }

  #showNoDownload(name, canPreview, what = 'document') {
    noAccessDialog({ kind: 'download', name, owner: this.opts.owner, contact: this.opts.contact?.(), canPreview, what });
  }

  // ---------- Tree ----------

  #renderTree() {
    const active = (p) => (!this.query && p === this.path ? ' active' : '');
    const node = (label, path, depth, iconName, count, kids, open) => h('div', { class: `tnode${active(path)}`, style: `--d:${depth}` },
      kids
        ? h('button', {
          class: 'twisty', type: 'button', 'aria-label': open ? 'Collapse' : 'Expand',
          onclick: () => { if (open) this.expanded.delete(path); else this.expanded.add(path); this.#renderTree(); },
        }, icon(open ? 'chevron-down' : 'chevron-right', 14))
        : h('span', { class: 'twisty' }),
      h('button', { class: 'tlabel', type: 'button', title: label, onclick: () => this.go(path) },
        icon(iconName, 16), h('span', { text: label }),
        ...(() => { const t = this.#tags(path, true); return t.length ? t : [h('em', { text: count })]; })()),
    );
    const build = (dir, depth) => sortedDirs(dir).flatMap((d) => {
      const open = this.expanded.has(d.path);
      const kids = d.dirs.size > 0;
      const row = node(d.name, d.path, depth, 'folder', countFiles(d), kids, open);
      return open && kids ? [row, ...build(d, depth + 1)] : [row];
    });
    this.treeEl.replaceChildren(
      node(this.rootLabel, '', 0, 'home', countFiles(this.root), false, true),
      ...build(this.root, 0),
    );
  }

  // ---------- Breadcrumbs and toolbar ----------

  #renderBar() {
    const parts = [h('button', { class: 'crumb', type: 'button', onclick: () => this.go('') }, icon('home', 15), h('span', { text: this.rootLabel }))];
    if (this.query) {
      parts.push(h('span', { class: 'sep' }, icon('chevron-right', 14)), h('span', { class: 'crumb current', title: this.query }, h('span', { text: `Search: “${this.query}”` })));
    } else {
      let acc = '';
      const segs = this.path ? this.path.split('/') : [];
      // Deep paths show only the last three folders (two on a phone); "…" stands in for the rest
      // and goes to the deepest folder it hides.
      const wide = Math.max(0, segs.length - 3);
      const narrow = Math.max(0, segs.length - 2);
      if (narrow > 0) {
        const more = wide > 0 ? 'mid-more' : 'mid-more phone';
        const up = segs.slice(0, wide || narrow).join('/');
        parts.push(h('span', { class: `sep ${more}` }, icon('chevron-right', 14)),
          h('button', { class: `crumb ${more}`, type: 'button', title: up, onclick: () => this.go(up) }, h('span', { text: '…' })));
      }
      segs.forEach((seg, i) => {
        acc = acc ? `${acc}/${seg}` : seg;
        const p = acc;
        const mid = i < wide ? ' mid' : i < narrow ? ' mid phone' : '';
        parts.push(h('span', { class: `sep${mid}` }, icon('chevron-right', 14)));
        parts.push(i === segs.length - 1
          ? h('span', { class: 'crumb current', title: seg }, h('span', { text: seg }))
          : h('button', { class: `crumb${mid}`, type: 'button', title: seg, onclick: () => this.go(p) }, h('span', { text: seg })));
      });
      const here = findNode(this.root, this.path);
      if (here?.node.id && this.opts.showIds !== false) parts.push(idChip(here.node.id));
    }
    this.crumbs.replaceChildren(...parts);
    const tools = this.query ? [] : [...(this.opts.toolbar?.(this.path) || [])];
    const here = findNode(this.root, this.path);
    // Shown whenever there is something to open; downloads that are turned off explain themselves.
    if (!this.query && here && walkFiles(here.node).some((f) => !this.#blocked(f))) {
      const label = this.path ? 'Download folder' : 'Download all';
      const any = walkFiles(here.node).some((f) => this.#savable(f));
      const b = this.#downloadButton(label, () => this.downloadFolder(here), any,
        () => this.#showNoDownload(this.path.split('/').pop() || this.rootLabel, false, this.path ? 'folder' : 'all'), 'soft');
      if (any) b.title = 'Download as a .zip';
      tools.push(b);
    }
    this.tools.replaceChildren(...tools);
  }

  // ---------- File list ----------

  #row({ kind, name, meta, onOpen, actions, data, extra, tags = [], dim, id }) {
    const r = h('div', {
      class: `row${dim ? ' locked' : ''}`, role: 'button', tabindex: '0', 'data-path': data,
      onclick: onOpen,
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === r) onOpen(); },
    },
    typeIcon(kind),
    h('div', { class: 'rtext' },
      h('span', { class: 'rname-line' }, h('span', { class: 'rname', text: name }), ...tags),
      (meta || id) && h('span', { class: 'rmeta' }, id && this.opts.showIds !== false && idChip(id), meta && h('span', { text: meta })),
      extra),
    h('div', { class: 'ractions', onclick: (e) => e.stopPropagation() }, ...actions),
    );
    return r;
  }

  #fileActions(f) {
    if (this.#blocked(f)) return [];
    const acts = [this.#downloadButton('Download', () => this.download(f), this.#savable(f), () => this.#showNoDownload(f.name, true), 'icon')];
    const menu = this.opts.rowMenu?.(f, false);
    if (menu?.length) acts.push(this.#menuButton(menu));
    return acts;
  }

  #menuButton(items) {
    const b = btn('More actions', () => popMenu(b, items), { kind: 'icon', iconName: 'more' });
    return b;
  }

  #renderList() {
    const n = findNode(this.root, this.path);
    const dirs = sortedDirs(n.node);
    const files = sortedFiles(n.node);
    const out = [];
    if (dirs.length) {
      out.push(h('div', { class: 'section-label', text: `Folders · ${dirs.length}` }));
      for (const d of dirs) out.push(this.#dirRow(d));
    }
    if (files.length) {
      out.push(h('div', { class: 'section-label', text: `Files · ${files.length}` }));
      for (const f of files) out.push(this.#fileRow(f));
    }
    if (!out.length) {
      out.push(h('div', { class: 'empty' }, icon('folder', 28), h('p', { text: 'This folder is empty.' }),
        this.opts.onDropFiles && h('p', { class: 'hint', text: 'Drop files here to upload them.' })));
    }
    this.listEl.replaceChildren(...out);
    this.listEl.scrollTop = 0;
    this.#markActive();
  }

  #dirRow(d, { meta } = {}) {
    const menu = this.opts.rowMenu?.(d, true);
    const tag = this.#tag(d.path, true, d);
    return this.#row({
      kind: 'folder', name: d.name, data: d.path, tags: this.#tags(d.path, true, d, { row: true }), dim: !!(tag && this.opts.isBlocked), id: d.id,
      meta: meta ?? plural(countFiles(d), 'file'),
      onOpen: () => this.go(d.path),
      actions: menu?.length ? [this.#menuButton(menu)] : [],
    });
  }

  #fileRow(f, { meta, extra, extraActions = [] } = {}) {
    const blocked = this.#blocked(f);
    return this.#row({
      kind: extOf(f.name), name: f.name, data: f.p, tags: this.#tags(f.p, false, f), dim: blocked, extra, id: f.i,
      meta: meta ?? [blocked ? 'Locked' : null, formatSize(f.s), formatDate(f.m)].filter(Boolean).join(' · '),
      onOpen: () => this.preview(f),
      actions: [...extraActions, ...this.#fileActions(f)],
    });
  }

  #markActive() {
    for (const r of this.listEl.querySelectorAll('.row')) {
      r.classList.toggle('active', r.dataset.path === this.viewer.path);
    }
  }

  // ---------- Search ----------

  search(q) {
    this.query = String(q || '').trim();
    this.el.classList.remove('side-open');
    this.render();
  }

  async #renderSearch() {
    const tok = ++this.searchTok;
    // An F-/D- ID finds that one folder or document straight away.
    const id = parseId(this.query);
    if (id) {
      const hit = findById(this.root, id);
      const out = [h('div', { class: 'section-label', text: hit ? '1 result' : 'No results' })];
      if (hit?.kind === 'dir') out.push(this.#dirRow(hit.node, { meta: '/' + hit.path }));
      else if (hit) out.push(this.#fileRow(hit.file, { meta: '/' + (dirname(hit.path) || '') }));
      else out.push(h('div', { class: 'empty' }, icon('search', 28), h('p', { text: `Nothing here has the ID ${id}.` })));
      this.listEl.replaceChildren(...out);
      this.#markActive();
      return;
    }
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const files = walkFiles(this.root);
    const byName = files.filter((f) => words.every((w) => f.p.toLowerCase().includes(w)));
    this.listEl.replaceChildren(h('div', { class: 'pv-msg' }, h('span', { class: 'spinner' }), 'Searching…'));
    let byText = [];
    if (this.opts.searchText) {
      let texts = {};
      try {
        texts = (await this.opts.searchText()) || {};
      } catch (e) {
        toast(e.message, 'error');
      }
      if (tok !== this.searchTok) return;
      const named = new Set(byName.map((f) => f.p));
      byText = files
        .filter((f) => !named.has(f.p))
        .map((f) => ({ f, text: texts[f.p] || '' }))
        .filter(({ text }) => { const l = text.toLowerCase(); return words.every((w) => l.includes(w)); });
    } else if (this.opts.searchContent) {
      let hits = [];
      try {
        hits = (await this.opts.searchContent(this.query)) || [];
      } catch (e) {
        toast(e.message, 'error');
      }
      if (tok !== this.searchTok) return;
      const named = new Set(byName.map((f) => f.p));
      const byPath = new Map(files.map((f) => [f.p, f]));
      // The server marks matches with [[ ]]; the snippet is shown with the typed words highlighted.
      byText = hits.filter((x) => byPath.has(x.p) && !named.has(x.p))
        .map((x) => ({ f: byPath.get(x.p), text: String(x.snip || '').replace(/\[\[|\]\]/g, '') }));
    }
    if (tok !== this.searchTok) return;
    const total = byName.length + byText.length;
    const out = [h('div', { class: 'section-label', text: total ? `${total} result${total === 1 ? '' : 's'}` : 'No results' })];
    const result = (f, snippet) => this.#fileRow(f, {
      meta: '/' + (dirname(f.p) || ''),
      extra: snippet,
      extraActions: [btn('Show in folder', () => this.go(dirname(f.p)), { kind: 'icon', iconName: 'folder' })],
    });
    for (const f of byName.slice(0, 60)) out.push(result(f));
    for (const { f, text } of byText.slice(0, 60)) out.push(result(f, highlight(text, words)));
    if (!total) out.push(h('div', { class: 'empty' }, icon('search', 28), h('p', { text: `Nothing matches “${this.query}”.` })));
    this.listEl.replaceChildren(...out);
    this.#markActive();
  }

  // ---------- Actions ----------

  /** Go to the folder or open the document with this ID. Returns false when there is none. */
  openId(input) {
    const id = parseId(input);
    const hit = id && findById(this.root, id);
    if (!hit) return false;
    if (hit.kind === 'dir') {
      this.go(hit.path);
    } else {
      this.go(dirname(hit.path));
      this.preview(hit.file);
    }
    return true;
  }

  async preview(f) {
    if (this.#blocked(f)) return this.#showLocked(f);
    this.viewer.loading(f.p);
    this.#markActive();
    try {
      const bytes = await this.opts.readFile(f);
      if (this.viewer.path !== f.p) return;
      const savable = this.#savable(f);
      const onDownload = savable ? () => saveBytes(f.name, bytes) : () => this.#showNoDownload(f.name, true);
      await this.viewer.show({ name: f.name, path: f.p, bytes, onDownload, noSave: !savable, id: f.i, offButton: (label, kind) => this.#downloadButton(label, null, false, onDownload, kind) });
    } catch (e) {
      console.error(e);
      if (this.viewer.path === f.p) this.viewer.error(e.message || 'Something went wrong.');
    }
    this.#markActive();
  }

  async download(f) {
    if (!this.#savable(f)) return this.#showNoDownload(f.name, true);
    const t = toast(`Downloading ${f.name}…`, 'busy', 0);
    try {
      saveBytes(f.name, await this.opts.readFile(f));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      t.close();
    }
  }

  async downloadFolder(n) {
    // Files this key cannot open, and files with downloading turned off, are left out of the .zip.
    const every = walkFiles(n.node);
    const files = every.filter((f) => this.#savable(f));
    const offCount = every.filter((f) => !this.#blocked(f) && !this.#savable(f)).length;
    if (!files.length) {
      if (offCount) return this.#showNoDownload(n.path.split('/').pop() || this.rootLabel, false);
      return toast('Nothing to download here.', 'error');
    }
    if (offCount) toast(`Leaving out ${plural(offCount, 'file')} that cannot be downloaded.`, 'info', 5000);
    const prefix = n.path ? n.path + '/' : '';
    const name = `${n.path.split('/').pop() || this.opts.zipName || 'jings-vault'}.zip`;
    const t = toast(`Preparing ${files.length} files…`, 'busy', 0);
    try {
      const zip = await zipFiles(
        files.map((f) => ({ path: f.p.slice(prefix.length), read: () => this.opts.readFile(f) })),
        (i, all) => t.set(`Zipping ${i} of ${all}…`),
      );
      saveBytes(name, zip, 'application/zip');
      toast(`Downloaded ${name} (${formatSize(zip.length)})`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      t.close();
    }
  }

  #enableDrop() {
    let depth = 0;
    this.main.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files') || this.query) return;
      depth++;
      this.main.classList.add('dropping');
    });
    this.main.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.main.classList.remove('dropping');
    });
    this.main.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files') && !this.query) e.preventDefault();
    });
    this.main.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length || this.query) return;
      e.preventDefault();
      depth = 0;
      this.main.classList.remove('dropping');
      this.opts.onDropFiles(this.path, [...e.dataTransfer.files]);
    });
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Small F-/D- ID label; clicking it copies the ID. */
export function idChip(id) {
  return h('button', {
    class: 'id-chip', type: 'button', title: 'Copy ID', text: id,
    onclick: (e) => {
      e.stopPropagation();
      copyText(id, `Copied ${id}`);
    },
  });
}

function highlight(text, words) {
  const lower = text.toLowerCase();
  const at = Math.max(0, lower.indexOf(words[0]));
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + words[0].length + 100);
  const piece = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const out = h('span', { class: 'snippet' });
  let last = 0;
  for (const m of piece.matchAll(re)) {
    out.append(piece.slice(last, m.index), h('mark', { text: m[0] }));
    last = m.index + m[0].length;
  }
  out.append(piece.slice(last));
  return out;
}
