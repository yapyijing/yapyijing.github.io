// Jing's Vault: unlock with an access key, then browse the files this key may see.
// Everything comes from the vault API, which checks Lock, Hide and the key's grants on every request.
import { CONFIG } from './config.js';
import * as C from './crypto.js';
import { h, icon, btn, toast, modal } from './ui.js';
import { NotesBrowser } from './browser.js';
import { MyFiles } from './myfiles.js';
import { buildTree, findNode, setDirIds } from './tree.js';
import { parseId } from './ids.js';

const SESSION = 'vault-session'; // { token, expires }
const OLD_KEY = 'notes-session-key'; // the access key itself, remembered by the previous version of the site
const EXPIRED = `This key is invalid, expired or has been revoked. Ask ${CONFIG.ownerName} for a new one.`;
const rootEl = document.getElementById('root');

// The API this page talks to. Only a copy opened on this Mac (127.0.0.1) may point elsewhere, for testing.
const API = (() => {
  if (location.hostname === '127.0.0.1') {
    try {
      const o = localStorage.getItem('vault-api-override');
      if (o) return o;
    } catch { /* storage blocked */ }
  }
  return CONFIG.apiBase;
})();

// Code version, taken from the versioned folder this script was loaded from (none when run from source).
const VERSION = import.meta.url.match(/\/assets\/([0-9a-f]{10})\//)?.[1] || null;
const CHECK_EVERY = 20_000;

// Drop the ?v=… left by a version reload, so the address stays clean.
if (new URLSearchParams(location.search).has('v')) history.replaceState(null, '', location.pathname + location.hash);

/** Load the latest website code. Tries once per version, so a slow cache cannot cause a reload loop. */
function reloadToLatest(version) {
  try {
    if (sessionStorage.getItem('vault-reloaded') === version) return false;
    sessionStorage.setItem('vault-reloaded', version);
  } catch {
    return false;
  }
  // A new address skips the browser's cached copy of the page.
  location.replace(`${location.pathname}?v=${encodeURIComponent(version)}`);
  return true;
}

/** The newest published code version, or null when it cannot be told (running from source, offline…). */
async function latestVersion() {
  if (!VERSION) return null;
  try {
    const r = await fetch(`assets/versions.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const list = await r.json();
    return Array.isArray(list) && list[0] !== VERSION ? list[0] : null;
  } catch {
    return null;
  }
}

// The session is remembered on the device until the key expires or the user logs out.
const store = {
  get() {
    try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; }
  },
  save(session) {
    try { localStorage.setItem(SESSION, JSON.stringify(session)); } catch { /* private mode */ }
  },
  oldKey() {
    try { return localStorage.getItem(OLD_KEY); } catch { return null; }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION);
      localStorage.removeItem(OLD_KEY);
      sessionStorage.removeItem(OLD_KEY); // left over from the old one-time keys
    } catch { /* private mode */ }
  },
};

const S = { session: null, rev: null, expires: null, root: null, contact: '', lockedDirs: new Set(), locks: [] };

// The admin console used to live on this origin; make sure no old GitHub token stays behind.
try {
  localStorage.removeItem('notes-admin-token');
  sessionStorage.removeItem('notes-admin-token');
} catch { /* storage blocked */ }
let browser = null;
let myFiles = null; // the user's private space, made when its tab is first opened
let tab = 'vault';
const views = {};
let watchTimer = null;
let checking = false;
let lastCheck = 0;

const shortDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// ---------- API ----------

class SignedOut extends Error {}
/** The owner closed the whole site for now (lockdown). */
class Closed extends Error {}

/** upload: a File sent as the raw request body; headers: extra request headers. */
async function call(path, { method = 'GET', body, raw = false, upload, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        ...(S.session ? { Authorization: `Bearer ${S.session.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(upload ? { 'Content-Type': 'application/octet-stream' } : {}),
        ...headers,
      },
      body: upload ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error('Cannot reach the vault. Check your connection and try again.');
  }
  if (res.status === 401 && path !== '/api/session') throw new SignedOut();
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 503 && data.error === 'lockdown') throw new Closed(data.message || 'The vault is closed for now.');
    const e = new Error(data.message || `The vault answered ${res.status}.`);
    e.status = res.status;
    e.code = data.error;
    throw e;
  }
  return raw ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

/** Trade an access key for a session. Returns false when the key does not work. */
async function signIn(key) {
  try {
    S.session = await call('/api/session', { method: 'POST', body: { key } });
    return true;
  } catch (e) {
    if (e.status === 401) return false;
    throw e;
  }
}

/** Load what this key can see, and work out which folders get a padlock or a no-download mark. */
async function loadTree() {
  const t = await call('/api/tree');
  Object.assign(S, { rev: t.rev, expires: t.expires, contact: t.contact || '', locks: t.locks || [] });
  S.root = buildTree(t.files, Object.keys(t.dirs));
  setDirIds(S.root, t.dirs);
  // A folder gets a padlock when it sits under a lock this key cannot open (unless an opening inside that
  // lock covers it), or when none of the files inside can be opened. No mark means open.
  const under = (root, p) => p === root || p.startsWith(`${root}/`);
  const opens = t.opens || [];
  const shut = (c, p) => under(c, p) && !opens.some((o) => o !== c && under(c, o) && under(o, p));
  const closed = t.locks.filter((l) => !l.o).map((l) => l.p);
  S.lockedDirs = new Set();
  const markDirs = (node) => {
    let any = false;
    let open = false;
    const take = (a, o) => { any = any || a; open = open || o; };
    for (const f of node.files.values()) take(true, canOpen(f));
    for (const d of node.dirs.values()) take(...markDirs(d));
    if (node.path && (closed.some((c) => shut(c, node.path)) || (any && !open))) S.lockedDirs.add(node.path);
    return [any, open];
  };
  markDirs(S.root);
}

const canOpen = (f) => !!f.o;
const canDownload = (f) => canOpen(f) && !f.nd;

function lockOut(message = EXPIRED) {
  Object.assign(S, { session: null, rev: null, expires: null, root: null, lockedDirs: new Set() });
  store.clear();
  clearInterval(watchTimer);
  browser = null;
  myFiles = null;
  myApi.pin = null;
  tab = 'vault';
  showLogin(message);
}

/** Run an API step; a revoked or expired key logs the page out, a lockdown shows the closed page. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SignedOut) {
      lockOut();
      throw new Error('Your access has ended.');
    }
    if (e instanceof Closed) {
      showClosed(e.message);
      throw new Error(e.message);
    }
    throw e;
  }
}

// ---------- Lockdown: the owner closed the whole site ----------

let closedTimer = null;

/** The lockdown message when the site is closed right now, else null (no key needed to ask). */
async function closedMessage() {
  try {
    const r = await fetch(`${API}/api/version`, { cache: 'no-store' });
    if (r.status !== 503) return null;
    const data = await r.json().catch(() => ({}));
    return data.error === 'lockdown' ? data.message || 'The vault is closed for now.' : null;
  } catch {
    return null;
  }
}

/** Replace everything with the closed page. The key stays remembered; the page reopens by itself. */
function showClosed(message) {
  clearInterval(watchTimer);
  clearInterval(closedTimer);
  browser = null;
  myFiles = null;
  myApi.pin = null;
  document.querySelector('.backdrop')?.remove();
  document.body.classList.remove('pv-full-open', 'no-print');
  document.title = "Jing's Vault (closed)";
  const tryAgain = async () => {
    if (await closedMessage() == null) {
      clearInterval(closedTimer);
      boot();
    }
  };
  rootEl.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'auth-card closed-card', role: 'status' },
    h('span', { class: 'brand-mark closed' }, icon('lock', 28)),
    h('h1', { text: "Jing's Vault is closed" }),
    h('p', { class: 'muted', text: message }),
    h('p', { class: 'hint', text: 'This page opens again by itself when the vault reopens.' }),
    btn('Try again', tryAgain, { kind: 'soft', iconName: 'refresh' }))));
  closedTimer = setInterval(tryAgain, 30_000);
}

// ---------- Live updates ----------

/** Notice changes while the page is open: refresh the file list, log out a revoked key, offer new code. */
async function checkForUpdates() {
  if (!S.session || checking) return;
  if (S.expires && Date.parse(S.expires) <= Date.now()) return lockOut();
  if (document.visibilityState !== 'visible') return;
  checking = true;
  lastCheck = Date.now();
  try {
    const { rev } = await call('/api/version');
    if (rev !== S.rev) {
      await loadTree();
      browser?.setTree(S.root);
      toast('Vault updated');
    }
    const newer = await latestVersion();
    if (newer) showUpdateBanner(newer);
  } catch (e) {
    if (e instanceof SignedOut) lockOut();
    else if (e instanceof Closed) showClosed(e.message);
    // Otherwise offline for a moment: try again next time.
  } finally {
    checking = false;
  }
}

function startWatching() {
  clearInterval(watchTimer);
  watchTimer = setInterval(checkForUpdates, CHECK_EVERY);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_EVERY / 2) checkForUpdates();
});

/** A week before this user's access ends, remind them to download My files (kept N days after the end). */
async function checkAccessEnd() {
  let me;
  try {
    me = await guarded(() => call('/api/me'));
  } catch {
    return;
  }
  const left = me.accessEnds ? Date.parse(me.accessEnds) - Date.now() : Infinity;
  if (left > 7 * 86400000 || !me.files || document.querySelector('.end-banner')) return;
  try {
    if (sessionStorage.getItem('vault-end-banner') === me.accessEnds) return;
  } catch { /* storage blocked */ }
  const banner = h('div', { class: 'update-banner end-banner', role: 'status' },
    icon('clock', 16),
    h('span', { text: `Your access ends on ${shortDate(me.accessEnds)}. My files is kept ${me.keepDays} days after that, then deleted. Download what you need.` }),
    btn('Download everything', async () => {
      await S.switchTab?.('mine');
      await myFiles?.downloadAll();
    }, { kind: 'primary', iconName: 'download' }),
    btn('Hide', () => {
      try { sessionStorage.setItem('vault-end-banner', me.accessEnds); } catch { /* storage blocked */ }
      banner.remove();
    }, { kind: 'icon', iconName: 'x' }));
  document.querySelector('.topbar')?.after(banner);
}

function showUpdateBanner(version) {
  if (document.querySelector('.update-banner')) return;
  const reload = () => {
    try { sessionStorage.removeItem('vault-reloaded'); } catch { /* storage blocked */ }
    if (version) reloadToLatest(version);
    else location.reload();
  };
  const banner = h('div', { class: 'update-banner', role: 'status' },
    icon('refresh', 16),
    h('span', { text: 'A new version of the vault is available.' }),
    btn('Refresh', reload, { kind: 'primary' }));
  document.querySelector('.topbar')?.after(banner);
}

/** Read a file. If the vault changed since the list was loaded, reload the list and say why it failed. */
async function readFile(file) {
  if (!canOpen(file)) throw new Error('This file is locked.');
  return guarded(async () => {
    try {
      return await call(`/api/files/${file.i}`, { raw: true });
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e;
      await loadTree();
      browser?.setTree(S.root);
      const fresh = findNode(S.root, file.p);
      if (fresh?.kind === 'file' && canOpen(fresh.file) && fresh.file.i !== file.i) return call(`/api/files/${fresh.file.i}`, { raw: true });
      throw new Error(e.status === 403 ? 'This file is locked.' : 'This file is no longer available.');
    }
  });
}

/** Full-text search, done by the API among the files this key can open. */
async function searchContent(query) {
  if (parseId(query)) return [];
  const { hits } = await guarded(() => call(`/api/search?q=${encodeURIComponent(query)}`));
  return hits;
}

/** Ask the AI assistant about one document. Errors keep the API's code (assistant_unavailable…). */
function askAssistant(fileId, messages) {
  return guarded(() => call('/api/assistant', { method: 'POST', body: { file: fileId, messages } }));
}

// ---------- PINs on Locks ----------

const covers = (root, p) => p === root || p.startsWith(`${root}/`);

/** The outermost Lock this key cannot open around `path`, if it has a PIN (else null: ask the owner). */
function pinLockFor(path) {
  const closed = S.locks.filter((l) => !l.o && covers(l.p, path)).sort((a, b) => a.p.length - b.p.length);
  return closed[0]?.k ? closed[0] : null;
}

/** Ask for a Lock's PIN. On the right PIN the list reloads and `then` runs (for example, opening the file). */
async function askPin(lock, then) {
  const name = lock.p.split('/').pop();
  const input = h('input', {
    class: 'field big pin-input', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off',
    'aria-label': `PIN for ${name}`, placeholder: '••••',
    oninput: () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); },
  });
  const err = h('p', { class: 'form-error', role: 'alert' });
  let expires = null;
  const ok = await modal({
    title: 'Enter PIN',
    body: h('div', { class: 'stack gap modal-center' },
      h('div', { class: 'locked-art' }, icon('lock', 30)),
      h('p', { class: 'modal-text', text: `“${name}” is locked. Enter its 4-digit PIN to open it for 12 hours.` }),
      input,
      err,
      S.contact ? h('p', { class: 'hint', text: `No PIN? Email ${CONFIG.ownerName}: ${S.contact}` }) : null),
    actions: [
      { label: 'Cancel', value: false, kind: 'ghost' },
      {
        label: 'Unlock', kind: 'primary', submit: true, icon: 'unlock', value: true,
        validate: async () => {
          if (!/^\d{4}$/.test(input.value)) {
            err.textContent = 'The PIN is 4 digits.';
            return false;
          }
          err.textContent = '';
          try {
            ({ expires } = await guarded(() => call(`/api/unlock/${lock.i}`, { method: 'POST', body: { pin: input.value } })));
            return true;
          } catch (e) {
            err.textContent = e.message;
            input.value = '';
            input.focus();
            return false;
          }
        },
      },
    ],
  });
  if (!ok) return;
  toast(`Unlocked “${name}” until ${shortDate(expires)}.`);
  try {
    await loadTree();
    browser?.setTree(S.root);
    await then?.();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** The X-Vault-Pin header while this device's My files unlock is still valid. */
const myPinHeader = () => (myApi.pin && Date.parse(myApi.pin.expires) > Date.now() ? { 'X-Vault-Pin': myApi.pin.token } : {});

/** The private space API ("My files"), for myfiles.js. `pin` is this device's unlock ({ token, expires }) once typed. */
const myApi = {
  pin: null,
  tree: () => guarded(() => call('/api/my/tree')),
  setPin: (pin, current) => guarded(() => call('/api/my/pin', { method: 'POST', body: { pin, current }, headers: myPinHeader() })),
  unlockPin: (pin) => guarded(() => call('/api/my/pin/unlock', { method: 'POST', body: { pin } })),
  createFolder: (parent, name) => guarded(() => call('/api/my/folders', { method: 'POST', body: { parent, name }, headers: myPinHeader() })),
  upload: (parent, file, replace) => {
    const q = new URLSearchParams({ name: file.name });
    if (parent) q.set('parent', parent);
    if (replace) q.set('replace', '1');
    return guarded(() => call(`/api/my/files?${q}`, { method: 'POST', upload: file, headers: myPinHeader() }));
  },
  read: (id) => guarded(() => call(`/api/my/files/${id}`, { raw: true, headers: myPinHeader() })),
  update: (id, body) => guarded(() => call(`/api/my/items/${id}`, { method: 'PATCH', body, headers: myPinHeader() })),
  trash: (id) => guarded(() => call(`/api/my/items/${id}`, { method: 'DELETE', headers: myPinHeader() })),
  listTrash: () => guarded(() => call('/api/my/trash')),
  restore: (id) => guarded(() => call(`/api/my/items/${id}/restore`, { method: 'POST' })),
  purge: (id) => guarded(() => call(`/api/my/trash/${id}`, { method: 'DELETE', headers: myPinHeader() })),
};

// ---------- Screens ----------

function showLogin(message = '') {
  document.title = "Jing's Vault";
  const input = h('input', {
    class: 'field big', autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Access key',
  });
  const error = h('p', { class: 'form-error', role: 'alert', text: message });
  const submit = btn('Unlock', null, { kind: 'primary', iconName: 'lock', type: 'submit' });
  const form = h('form', {
    class: 'auth-card',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!C.isPlausibleKey(C.normaliseKey(input.value))) {
        error.textContent = 'That does not look like a key. Keys look like XXXX-XXXX-XXXX-XXXX.';
        return;
      }
      submit.disabled = true;
      submit.lastChild.textContent = 'Checking…';
      error.textContent = '';
      try {
        if (await signIn(input.value)) {
          store.save(S.session);
          await loadTree();
          showApp();
          return;
        }
        error.textContent = EXPIRED;
      } catch (err) {
        if (err instanceof Closed) return showClosed(err.message);
        error.textContent = err.message;
      }
      submit.disabled = false;
      submit.lastChild.textContent = 'Unlock';
    },
  },
  h('span', { class: 'brand-mark' }, icon('vault', 28)),
  h('h1', { text: "Jing's Vault" }),
  h('p', { class: 'muted', text: `Enter the access key ${CONFIG.ownerName} sent you.` }),
  input,
  submit,
  error,
  );
  rootEl.replaceChildren(h('main', { class: 'auth' }, form));
  input.focus();
}

function showApp() {
  document.title = "Jing's Vault";
  const search = h('input', {
    class: 'search-input', type: 'search', placeholder: 'Search names, contents or IDs…', 'aria-label': 'Search the vault',
    autocomplete: 'off', spellcheck: 'false',
  });
  let lastQuery = '';
  const runSearch = debounce(() => {
    if (search.value.trim() === lastQuery) return;
    lastQuery = search.value.trim();
    current().search(lastQuery);
  }, 250);
  search.addEventListener('input', runSearch);
  search.addEventListener('keyup', runSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      lastQuery = '';
      current().search('');
    }
  });
  const current = () => (tab === 'mine' && myFiles ? myFiles.browser : browser);
  const clearSearch = () => {
    search.value = '';
    lastQuery = '';
  };
  const tabBtn = (id, label, iconName) => h('button', { class: 'tab', type: 'button', 'data-tab': id, onclick: () => switchTab(id) }, icon(iconName, 16), h('span', { text: label }));

  const until = h('span', { text: `Until ${shortDate(S.expires)}` });
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark sm' }, icon('vault', 19)), h('span', { class: 'brand-name', text: "Jing's Vault" })),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' }, tabBtn('vault', 'Vault', 'book'), tabBtn('mine', 'My files', 'user')),
    h('label', { class: 'search' }, icon('search', 16), search),
    h('div', { class: 'top-right' },
      h('span', { class: 'pill', title: 'Your access ends at this time' }, icon('clock', 14), until),
      btn('Log out', () => {
        lockOut('');
        toast('Logged out. The key has been removed from this device.');
      }, { kind: 'ghost', iconName: 'logout' }),
    ),
  );
  views.vault = h('div', { class: 'view' });
  views.mine = h('div', { class: 'view', hidden: true });
  const body = h('div', { class: 'shell-body' }, views.vault, views.mine);
  rootEl.replaceChildren(h('div', { class: 'shell' }, top, body));

  /** Vault or My files. My files loads when first opened, and again each time it is opened. */
  async function switchTab(next) {
    tab = next;
    for (const [name, el] of Object.entries(views)) el.hidden = name !== next;
    for (const b of top.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === next);
    search.placeholder = next === 'mine' ? 'Search my files…' : 'Search names, contents or IDs…';
    if (lastQuery) {
      clearSearch();
      browser?.search('');
      myFiles?.browser.search('');
    }
    if (next !== 'mine') return;
    if (!myFiles) {
      myFiles = new MyFiles(views.mine, myApi);
      myFiles.browser.onNavigate = clearSearch;
    }
    try {
      await myFiles.load();
    } catch (e) {
      if (!(e instanceof SignedOut) && S.session) toast(e.message, 'error');
    }
  }
  S.switchTab = switchTab;

  browser = new NotesBrowser(views.vault, {
    readFile,
    searchContent,
    askAssistant,
    tag: (p, isDir, item) => ((isDir ? S.lockedDirs.has(p) : !canOpen(item)) ? 'lock' : null),
    isBlocked: (f) => !canOpen(f),
    onLocked: (f) => {
      const lock = pinLockFor(f.p);
      if (!lock) return false;
      askPin(lock, () => {
        const fresh = findNode(S.root, f.p);
        if (fresh?.kind === 'file' && canOpen(fresh.file)) browser.preview(fresh.file);
      });
      return true;
    },
    // Inside a Lock with a PIN: a button to type it.
    toolbar: (path) => {
      const lock = path ? pinLockFor(path) : null;
      return lock ? [btn('Enter PIN', () => askPin(lock), { kind: 'primary', iconName: 'unlock', title: `Open “${lock.p.split('/').pop()}” with its PIN` })] : [];
    },
    canDownload,
    owner: CONFIG.ownerName,
    // Read when a popup opens, so it follows the latest list.
    contact: () => S.contact,
  });
  browser.onNavigate = clearSearch;
  browser.setTree(S.root);
  switchTab('vault');
  checkAccessEnd();
  lastCheck = Date.now();
  startWatching();
  openFromHash();
}

/** A link like …/#D-7F3K9Q opens that document (or folder) once the vault is unlocked. */
function openFromHash() {
  const id = parseId(decodeURIComponent(location.hash.slice(1)));
  if (!id || !browser) return;
  if (tab !== 'vault') S.switchTab?.('vault');
  if (!browser.openId(id)) toast(`Nothing here has the ID ${id}.`, 'error');
}
window.addEventListener('hashchange', openFromHash);

async function boot() {
  const newer = await latestVersion();
  if (newer && reloadToLatest(newer)) return;
  const closed = await closedMessage();
  if (closed) return showClosed(closed);
  S.session = store.get();
  const oldKey = !S.session && store.oldKey();
  if (!S.session && !oldKey) return showLogin();
  rootEl.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'pv-msg' }, h('span', { class: 'spinner' }), 'Unlocking…')));
  try {
    // A key remembered by the previous version of the site is traded for a session once, then forgotten.
    if (oldKey) {
      if (!(await signIn(oldKey))) return lockOut();
      store.clear();
      store.save(S.session);
    }
    await loadTree();
    return showApp();
  } catch (e) {
    if (e instanceof SignedOut) return lockOut();
    if (e instanceof Closed) return showClosed(e.message);
    S.session = null;
    showLogin(e.message);
  }
}

boot();
