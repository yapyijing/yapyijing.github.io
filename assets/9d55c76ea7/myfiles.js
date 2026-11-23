// My files: the signed-in user's private space. It uses the same file browser as the vault,
// with upload, folders, rename, move, delete and a trash. Only this user (with any of their keys) sees it.
import { h, icon, btn, toast, modal, promptDialog, confirmDialog, popMenu } from './ui.js';
import { NotesBrowser } from './browser.js';
import { buildTree, setDirIds, findNode, walkFiles, formatSize, formatDate, basename, dirname, joinPath } from './tree.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class MyFiles {
  /**
   * api: {
   *   tree(): Promise<{ items, used, quota, maxFile }>
   *   createFolder(parentId, name), upload(parentId, file, replace) → { id }
   *   read(id): Promise<Uint8Array>, update(id, { name?, parent? }), trash(id)
   *   listTrash(): Promise<{ days, items }>, restore(id), purge(id)
   *   setPin(pin, current?), unlockPin(pin) → { token, expires }; pin: this device's unlock (set here)
   * }
   * Items locked with the user's PIN (and everything inside a locked folder) open only while this device
   * is unlocked (15 minutes after typing the PIN).
   */
  constructor(mount, api) {
    this.api = api;
    this.root = null;
    this.dirIds = new Map([['', null]]);
    this.usage = { used: 0, quota: 0, maxFile: 0 };
    this.pinInfo = { set: false, resetAt: null };
    this.lockRoots = new Set();
    this.lockTimer = null;
    this.resetNoted = false;
    this.loaded = false;
    this.picker = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => {
      const files = [...this.picker.files];
      this.picker.value = '';
      this.upload(this.uploadTo, files);
    } });
    mount.append(this.picker);
    this.browser = new NotesBrowser(mount, {
      readFile: (f) => this.api.read(f.i),
      rootLabel: 'My files',
      zipName: 'my-files',
      showIds: false,
      toolbar: (path) => this.#toolbar(path),
      rowMenu: (item, isDir) => this.#rowMenu(item, isDir),
      onDropFiles: (path, files) => this.upload(path, files),
      // PIN locks: a padlock and no opening until this device is unlocked.
      tag: (p) => (this.#lockedBy(p) && !this.unlocked ? 'lock' : null),
      isBlocked: (f) => !!this.#lockedBy(f.p) && !this.unlocked,
      onLocked: (f) => {
        this.askPin(() => {
          const fresh = findNode(this.root, f.p);
          if (fresh?.kind === 'file') this.browser.preview(fresh.file);
        });
        return true;
      },
    });
  }

  get unlocked() {
    return !!this.api.pin && Date.parse(this.api.pin.expires) > Date.now();
  }

  /** The PIN-locked folder or file that covers `p` (the outermost), or undefined. */
  #lockedBy(p) {
    for (const root of this.lockRoots) if (p === root || p.startsWith(`${root}/`)) return root;
    return undefined;
  }

  /** Remember this device's unlock and lock again when it runs out. */
  #setUnlock(u) {
    this.api.pin = u;
    clearTimeout(this.lockTimer);
    if (u) this.lockTimer = setTimeout(() => this.lockNow(true), Math.max(0, Date.parse(u.expires) - Date.now()) + 500);
    this.browser.render();
  }

  lockNow(expired = false) {
    clearTimeout(this.lockTimer);
    this.api.pin = null;
    if (this.browser.viewer.path && this.#lockedBy(this.browser.viewer.path)) this.browser.viewer.hide();
    this.browser.render();
    if (!expired) toast('Locked again. Your PIN is needed to open locked items.');
  }

  /** Fetch the user's items again and redraw. */
  async load() {
    const t = await this.api.tree();
    this.usage = { used: t.used, quota: t.quota, maxFile: t.maxFile };
    this.pinInfo = t.pin || { set: false, resetAt: null };
    const byId = new Map(t.items.map((x) => [x.id, x]));
    const paths = new Map();
    const pathOf = (id, depth = 0) => {
      if (paths.has(id)) return paths.get(id);
      const x = byId.get(id);
      if (!x || depth > 64) return null;
      const above = x.parent == null ? '' : pathOf(x.parent, depth + 1);
      const p = above == null ? null : joinPath(above, x.name);
      paths.set(id, p);
      return p;
    };
    const files = [];
    const dirs = {};
    this.lockRoots = new Set();
    for (const x of t.items) {
      const p = pathOf(x.id);
      if (p == null) continue;
      if (x.locked) this.lockRoots.add(p);
      if (x.kind === 'dir') dirs[p] = x.id;
      else files.push({ p, i: x.id, s: x.size, m: x.mtime, o: 1 });
    }
    this.root = buildTree(files, Object.keys(dirs));
    setDirIds(this.root, dirs);
    this.dirIds = new Map([['', null], ...Object.entries(dirs)]);
    this.loaded = true;
    this.browser.setTree(this.root);
    // A preview of something that was just deleted, moved or renamed closes.
    const open = this.browser.viewer.path;
    if (open && (findNode(this.root, open)?.kind !== 'file' || (this.#lockedBy(open) && !this.unlocked))) this.browser.viewer.hide();
    // Tell the user once if the admin reset their PIN while something is locked.
    if (!this.pinInfo.set && this.pinInfo.resetAt && this.lockRoots.size && !this.resetNoted) {
      this.resetNoted = true;
      toast(`Your My files PIN was reset on ${formatDate(this.pinInfo.resetAt)}. Set a new one (PIN button) to open your locked items.`, 'error', 10000);
    }
  }

  /** Run a change with a busy note, then show the new state. Errors become toasts. */
  async #act(label, fn) {
    const t = toast(label, 'busy', 0);
    try {
      await fn();
      return true;
    } catch (e) {
      if (e.code === 'pin_required') {
        t.close();
        if (await this.askPin()) return this.#act(label, fn);
        return false;
      }
      toast(e.message || 'Something went wrong. Try again.', 'error', 6000);
      return false;
    } finally {
      t.close();
      await this.load().catch(() => {});
    }
  }

  // ---------- Toolbar ----------

  #meter() {
    const { used, quota } = this.usage;
    const share = quota ? Math.min(1, used / quota) : 0;
    const level = share >= 0.95 ? ' full' : share >= 0.8 ? ' high' : '';
    return h('span', { class: `usage${level}`, title: `${formatSize(used)} of ${formatSize(quota)} used. Files in Trash count too.` },
      h('span', { class: 'usage-bar' }, h('i', { style: `width:${Math.max(share * 100, used ? 2 : 0).toFixed(1)}%` })),
      h('span', { class: 'usage-text', text: `${formatSize(used)} of ${formatSize(quota)}` }));
  }

  #toolbar(path) {
    const upload = btn('Upload', () => {
      this.uploadTo = path;
      this.picker.click();
    }, { kind: 'primary', iconName: 'upload' });
    const pinBtn = btn(this.unlocked ? 'Unlocked' : 'PIN', () => popMenu(pinBtn, this.#pinMenu()), {
      kind: 'ghost', iconName: this.unlocked ? 'unlock' : 'key', title: 'Your My files PIN',
    });
    return [
      this.#meter(),
      pinBtn,
      btn('Trash', () => this.openTrash(), { kind: 'ghost', iconName: 'trash' }),
      btn('New folder', () => this.newFolder(path), { iconName: 'folder-plus' }),
      upload,
    ];
  }

  // ---------- PIN ----------

  #pinMenu() {
    if (!this.pinInfo.set) return [{ label: 'Set a PIN…', icon: 'key', onClick: () => this.setPin() }];
    return [
      this.unlocked
        ? { label: `Lock now (open until ${formatDate(this.api.pin.expires)})`, icon: 'lock', onClick: () => this.lockNow() }
        : { label: 'Unlock with PIN…', icon: 'unlock', onClick: () => this.askPin() },
      { label: 'Change PIN…', icon: 'key', onClick: () => this.setPin() },
    ];
  }

  #pinField(label) {
    const input = h('input', {
      class: 'field big pin-input', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', placeholder: '••••',
      'aria-label': label,
      oninput: () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); },
    });
    return input;
  }

  /** Set (or change) the PIN. Returns true when saved. */
  async setPin() {
    const change = this.pinInfo.set;
    const current = change && !this.unlocked ? this.#pinField('Current PIN') : null;
    const first = this.#pinField('New PIN');
    const again = this.#pinField('New PIN again');
    const err = h('p', { class: 'form-error', role: 'alert' });
    const note = !change && this.pinInfo.resetAt ? h('p', { class: 'hint', text: `Your PIN was reset by the owner on ${formatDate(this.pinInfo.resetAt)}.` }) : null;
    const ok = await modal({
      title: change ? 'Change your PIN' : 'Set a PIN for My files',
      body: h('div', { class: 'stack gap' },
        h('p', { class: 'modal-text', text: 'Lock files or folders with it (⋯ → Lock with PIN). They open only after you type it, for 15 minutes on this device.' }),
        note,
        current && h('label', { class: 'stack' }, h('span', { class: 'label', text: 'Current PIN' }), current),
        h('label', { class: 'stack' }, h('span', { class: 'label', text: 'New 4-digit PIN' }), first),
        h('label', { class: 'stack' }, h('span', { class: 'label', text: 'Type it again' }), again),
        h('p', { class: 'hint', text: 'Forgot it? The owner can reset it; you will see that it was reset.' }),
        err),
      actions: [
        { label: 'Cancel', value: false, kind: 'ghost' },
        { label: 'Save PIN', kind: 'primary', submit: true, icon: 'key', value: true,
          validate: async () => {
            if (!/^\d{4}$/.test(first.value)) { err.textContent = 'The PIN is 4 digits.'; return false; }
            if (first.value !== again.value) { err.textContent = 'The two PINs do not match.'; return false; }
            try {
              const r = await this.api.setPin(first.value, current?.value);
              this.#setUnlock({ token: r.token, expires: r.expires });
              return true;
            } catch (e) {
              err.textContent = e.message;
              return false;
            }
          } },
      ],
    });
    if (!ok) return false;
    this.pinInfo = { set: true, resetAt: this.pinInfo.resetAt };
    toast(change ? 'PIN changed.' : 'PIN saved. Lock things with ⋯ → Lock with PIN.');
    this.browser.render();
    return true;
  }

  /** Ask for the PIN and unlock this device for 15 minutes; then run `then`. Returns true when unlocked. */
  async askPin(then) {
    if (!this.pinInfo.set) {
      if (!(await this.setPin())) return false;
      await then?.();
      return true;
    }
    const input = this.#pinField('Your PIN');
    const err = h('p', { class: 'form-error', role: 'alert' });
    const ok = await modal({
      title: 'Enter your PIN',
      body: h('div', { class: 'stack gap modal-center' },
        h('div', { class: 'locked-art' }, icon('lock', 30)),
        h('p', { class: 'modal-text', text: 'This is locked with your My files PIN. It stays open on this device for 15 minutes.' }),
        input, err),
      actions: [
        { label: 'Cancel', value: false, kind: 'ghost' },
        { label: 'Unlock', kind: 'primary', submit: true, icon: 'unlock', value: true,
          validate: async () => {
            if (!/^\d{4}$/.test(input.value)) { err.textContent = 'The PIN is 4 digits.'; return false; }
            try {
              this.#setUnlock(await this.api.unlockPin(input.value));
              return true;
            } catch (e) {
              err.textContent = e.message;
              input.value = '';
              input.focus();
              return false;
            }
          } },
      ],
    });
    if (!ok) return false;
    await then?.();
    return true;
  }

  // ---------- Upload ----------

  /** Upload files into a folder. Asks once about names already there; checks size and space first. */
  async upload(path, files) {
    if (!files.length) return;
    const here = findNode(this.root, path)?.node;
    if (!here) return;
    const { used, quota, maxFile } = this.usage;
    const skipped = [];
    let list = files.filter((f) => {
      if (f.name.startsWith('.')) return false; // .DS_Store and other system files
      if (f.size > maxFile) {
        skipped.push(`“${f.name}” is over ${formatSize(maxFile)}`);
        return false;
      }
      if (here.dirs.has(f.name)) {
        skipped.push(`a folder called “${f.name}” is already here`);
        return false;
      }
      return true;
    });
    if (skipped.length) toast(`Skipped: ${skipped.join('; ')}.`, 'error', 7000);
    const clashes = list.filter((f) => here.files.has(f.name));
    let replace = false;
    if (clashes.length) {
      const choice = await modal({
        title: clashes.length === 1 ? 'Replace the file?' : `Replace ${clashes.length} files?`,
        body: h('p', { class: 'modal-text', text: clashes.length === 1
          ? `“${clashes[0].name}” is already here. Replace it with the new one?`
          : `${clashes.map((f) => `“${f.name}”`).slice(0, 4).join(', ')}${clashes.length > 4 ? ' and others' : ''} are already here.` }),
        actions: [
          { label: 'Cancel', value: null, kind: 'ghost' },
          { label: clashes.length === 1 ? 'Skip it' : 'Skip them', value: 'skip' },
          { label: 'Replace', value: 'replace', kind: 'primary', submit: true },
        ],
      });
      if (choice == null) return;
      if (choice === 'skip') list = list.filter((f) => !here.files.has(f.name));
      else replace = true;
    }
    if (!list.length) return;
    const freed = replace ? clashes.reduce((n, f) => n + (here.files.get(f.name)?.s || 0), 0) : 0;
    const need = list.reduce((n, f) => n + f.size, 0) - freed;
    if (used + need > quota) {
      const left = Math.max(0, quota - used);
      toast(`Not enough space: these need ${formatSize(need)}, and ${formatSize(left)} is left. Empty the Trash or delete something first.`, 'error', 8000);
      return;
    }
    const parent = this.dirIds.get(path) ?? null;
    const failed = [];
    let done = 0;
    await this.#act(`Uploading ${plural(list.length, 'file')}…`, async () => {
      for (const f of list) {
        try {
          await this.api.upload(parent, f, replace && here.files.has(f.name));
          done++;
        } catch (e) {
          failed.push(`${f.name}: ${e.message}`);
          if (e.code === 'quota_full') break;
        }
      }
    });
    if (done) toast(`Uploaded ${plural(done, 'file')}.`);
    if (failed.length) toast(`Not uploaded: ${failed.join('; ')}`, 'error', 8000);
  }

  // ---------- Folders and items ----------

  async newFolder(path) {
    const name = await promptDialog({ title: 'New folder', label: `Inside ${path ? `/${path}` : 'My files'}`, placeholder: 'e.g. Revision', confirm: 'Create' });
    if (!name) return;
    if (name.includes('/') || name.startsWith('.')) return toast('Folder names cannot contain "/" or start with a dot.', 'error');
    if (await this.#act('Creating folder…', () => this.api.createFolder(this.dirIds.get(path) ?? null, name))) toast(`Created “${name}”.`);
  }

  #rowMenu(item, isDir) {
    const path = isDir ? item.path : item.p;
    const by = this.#lockedBy(path);
    const lockItems = by === path
      ? [{ label: 'Remove PIN lock', icon: 'unlock', onClick: () => this.setLocked(item, isDir, false) }]
      : by ? [] : [{ label: 'Lock with PIN', icon: 'lock', onClick: () => this.setLocked(item, isDir, true) }];
    return [
      ...lockItems,
      { label: 'Rename', icon: 'edit', onClick: () => this.rename(item, isDir) },
      { label: 'Move to…', icon: 'move', onClick: () => this.move(item, isDir) },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => this.remove(item, isDir) },
    ];
  }

  async setLocked(item, isDir, locked) {
    const path = isDir ? item.path : item.p;
    if (locked && !this.pinInfo.set && !(await this.setPin())) return;
    if (await this.#act(locked ? 'Locking…' : 'Removing the lock…', () => this.api.update(isDir ? item.id : item.i, { locked }))) {
      toast(locked ? `Locked “${basename(path)}” with your PIN.` : `“${basename(path)}” no longer needs the PIN.`);
    }
  }

  async rename(item, isDir) {
    const path = isDir ? item.path : item.p;
    const name = await promptDialog({ title: `Rename ${isDir ? 'folder' : 'file'}`, label: 'New name', value: basename(path), confirm: 'Rename' });
    if (!name || name === basename(path)) return;
    if (name.includes('/') || name.startsWith('.')) return toast('Names cannot contain "/" or start with a dot.', 'error');
    if (await this.#act('Renaming…', () => this.api.update(isDir ? item.id : item.i, { name }))) toast(`Renamed to “${name}”.`);
  }

  async move(item, isDir) {
    const path = isDir ? item.path : item.p;
    const options = [...this.dirIds.keys()].sort()
      .filter((f) => f !== dirname(path) && !(isDir && (f === path || f.startsWith(`${path}/`))));
    if (!options.length) return toast('There is no other folder to move it to. Make one with New folder.', 'error');
    const select = h('select', { class: 'field' }, ...options.map((f) => h('option', { value: f, text: f ? `/${f}` : 'My files (top level)' })));
    const dest = await modal({
      title: `Move “${basename(path)}”`,
      body: h('label', { class: 'stack' }, h('span', { class: 'label', text: 'Move into' }), select),
      actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Move', kind: 'primary', submit: true, value: () => select.value }],
    });
    if (dest == null) return;
    if (await this.#act('Moving…', () => this.api.update(isDir ? item.id : item.i, { parent: this.dirIds.get(dest) ?? null }))) {
      toast(`Moved to ${dest ? `/${dest}` : 'My files'}.`);
    }
  }

  async remove(item, isDir) {
    const path = isDir ? item.path : item.p;
    const count = isDir ? walkFiles(item).length : 1;
    const ok = await confirmDialog({
      title: `Delete ${isDir ? 'folder' : 'file'}?`,
      message: isDir
        ? `“${basename(path)}” and ${plural(count, 'file')} inside it go to Trash. You can restore them for 30 days.`
        : `“${basename(path)}” goes to Trash. You can restore it for 30 days.`,
      confirm: 'Delete', danger: true,
    });
    if (!ok) return;
    if (await this.#act('Deleting…', () => this.api.trash(isDir ? item.id : item.i))) toast(`Moved “${basename(path)}” to Trash.`);
  }

  // ---------- Trash ----------

  async openTrash() {
    const body = h('div', { class: 'trash-list' }, h('div', { class: 'pv-msg' }, h('span', { class: 'spinner' }), 'Loading…'));
    const draw = async () => {
      let res;
      try {
        res = await this.api.listTrash();
      } catch (e) {
        body.replaceChildren(h('p', { class: 'form-error', text: e.message }));
        return;
      }
      if (!res.items.length) {
        body.replaceChildren(h('div', { class: 'empty' }, icon('trash', 26), h('p', { text: 'Trash is empty.' })));
        return;
      }
      const rows = res.items.map((x) => h('div', { class: 'trow' },
        h('span', { class: `ficon ${x.kind === 'dir' ? 'folder' : 'other'}` }, icon(x.kind === 'dir' ? 'folder' : 'file', 18)),
        h('div', { class: 'trow-text' },
          h('span', { class: 'trow-name', text: x.name }),
          h('span', { class: 'trow-meta', text: [x.kind === 'dir' ? plural(x.items - 1, 'item') + ' inside' : null, formatSize(x.size), `deleted ${formatDate(x.deleted_at)}`].filter(Boolean).join(' · ') })),
        btn('Restore', async () => {
          if (await this.#act('Restoring…', () => this.api.restore(x.id))) toast(`Restored “${x.name}”.`);
          draw();
        }, { kind: 'soft', iconName: 'refresh' }),
        btn('Delete for good', async () => {
          const sure = await confirmDialog({ title: 'Delete for good?', message: `“${x.name}” will be gone for good and free ${formatSize(x.size)}. This cannot be undone.`, confirm: 'Delete', danger: true });
          if (!sure) return;
          if (await this.#act('Deleting…', () => this.api.purge(x.id))) toast(`Deleted “${x.name}” for good.`);
          draw();
        }, { kind: 'icon', iconName: 'x' })));
      body.replaceChildren(
        h('p', { class: 'hint', text: `Kept for ${res.days} days, then deleted for good. Files in Trash still count towards your storage.` }),
        ...rows);
    };
    draw();
    await modal({ title: 'Trash', body, wide: true, actions: [{ label: 'Close', value: true, kind: 'primary', submit: true }] });
  }
}
