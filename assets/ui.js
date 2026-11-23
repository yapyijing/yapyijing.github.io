// Small UI kit: element builder, icons, toasts, dialogs and pop-up menus.

/** h('div', { class: 'x', onclick: fn, title: 't' }, child, 'text', …) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const PATHS = {
  folder: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
  'folder-plus': 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z M12 10.5v6 M9 13.5h6',
  file: 'M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z M14 3v5h5',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-3.8-3.8',
  download: 'M12 4v11 M7 10.5l5 5 5-5 M5 20h14',
  upload: 'M12 16V5 M7 9.5l5-5 5 5 M5 20h14',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  'eye-off': 'M4 4l16 16 M10 5.7c.6-.1 1.3-.2 2-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4 M6.4 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1.1 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  unlock: 'M6.5 11h11v9h-11z M9 11V8a3 3 0 0 1 5.8-1',
  expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  shrink: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  'download-off': 'M12 4v6 M12 14.5v.5 M7 10.5l3 3 M5 20h14 M4 4l16 16 M17 10.5l-1.6 1.6',
  x: 'M6 6l12 12 M18 6L6 18',
  'chevron-right': 'M9.5 6l6 6-6 6',
  'chevron-down': 'M6 9.5l6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  move: 'M4 12h13 M12.5 7l5 5-5 5 M20 5v14',
  trash: 'M4 7h16 M9.5 7V4.5h5V7 M6.5 7l1 13h9l1-13 M10 11v5.5 M14 11v5.5',
  key: 'M8 11a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M10.9 12.1L19 4 M16 7l2.5 2.5 M13.5 9.5L16 12',
  logout: 'M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14 M10 8l-4 4 4 4 M6 12h10',
  refresh: 'M19.5 11a7.5 7.5 0 1 0-2.2 5.8 M20 4.5V11h-6.5',
  copy: 'M9 9h10.5v11H9z M15 9V4.5H4.5V15H9',
  menu: 'M4 6.5h16 M4 12h16 M4 17.5h16',
  lock: 'M6.5 11h11v9h-11z M9 11V8a3 3 0 0 1 6 0v3',
  send: 'M4 12L20 4l-5 16-3-6.5z M12 13.5L20 4',
  external: 'M14 4h6v6 M20 4l-8.5 8.5 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  back: 'M19 12H5.5 M11 6l-6 6 6 6',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 7.5V12l3 2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4.5l8.5 15h-17z M12 10v4.5 M12 17.3h.01',
  home: 'M4 11l8-7 8 7 M6.5 9.5V20h11V9.5',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4.5 20a7.5 7.5 0 0 1 15 0',
  vault: 'M5.5 4h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M11 8.3a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z M11 11.5l1.5-1.5 M17 9v5 M6.5 19v1.5 M17.5 19v1.5',
  sparkle: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  book: 'M12 6.5C10.4 5.1 7.9 4.5 3.5 4.5v13c4.4 0 6.9.6 8.5 2 1.6-1.4 4.1-2 8.5-2v-13c-4.4 0-6.9.6-8.5 2z M12 6.5v13',
};

export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' ? '3' : '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name] || PATHS.file);
  svg.append(path);
  return svg;
}

/** Button with optional icon. kind: 'primary' | 'ghost' | 'danger' | 'soft' | 'icon' */
export function btn(label, onClick, { kind = 'soft', iconName, title, type = 'button' } = {}) {
  const b = h('button', { class: `btn ${kind}`, type, title: title || (kind === 'icon' ? label : null), 'aria-label': kind === 'icon' ? label : null });
  if (iconName) b.append(icon(iconName, kind === 'icon' ? 18 : 16));
  if (kind !== 'icon') b.append(h('span', { text: label }));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** Tinted square icon for a folder or file type. */
export function typeIcon(kind) {
  const map = { folder: ['folder', 'folder'], pdf: ['file', 'pdf'], html: ['file', 'html'], htm: ['file', 'html'] };
  const [name, cls] = map[kind] || ['file', 'other'];
  const label = kind === 'folder' ? null : (kind || 'file').toUpperCase().slice(0, 4);
  return h('span', { class: `ficon ${cls}` }, icon(name, 20), label && h('b', { text: label }));
}

// ---------- Toasts ----------

let toastHost;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast ${kind}` }, icon(kind === 'error' ? 'x' : kind === 'busy' ? 'clock' : 'check', 16), h('span', { text: message }));
  toastHost.append(t);
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  };
  if (ms) setTimeout(close, ms);
  return { close, set: (m) => { t.lastChild.textContent = m; } };
}

// ---------- Dialogs ----------

/** Generic modal. Resolves with the clicked action's value, or null when dismissed. */
export function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      back.classList.add('out');
      setTimeout(() => back.remove(), 180);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const foot = h('div', { class: 'modal-foot' });
    for (const a of actions) {
      const b = btn(a.label, async () => {
        if (a.validate) {
          const ok = await a.validate();
          if (!ok) return;
        }
        close(typeof a.value === 'function' ? a.value() : a.value);
      }, { kind: a.kind || 'soft', iconName: a.icon });
      if (a.submit) b.dataset.submit = '1';
      foot.append(b);
    }
    const form = h('form', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', { text: title }), btn('Close', () => close(null), { kind: 'icon', iconName: 'x' })),
      h('div', { class: 'modal-body' }, body),
      foot,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      foot.querySelector('button[data-submit]')?.click();
    });
    const back = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === back) close(null); } }, form);
    document.body.append(back);
    document.addEventListener('keydown', onKey);
    onOpen?.(form);
    (form.querySelector('input, select, textarea') || foot.lastChild)?.focus();
  });
}

export async function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', hint }) {
  const input = h('input', { class: 'field', value, placeholder, spellcheck: 'false', autocomplete: 'off' });
  const body = h('label', { class: 'stack' }, h('span', { class: 'label', text: label }), input, hint && h('span', { class: 'hint', text: hint }));
  const result = await modal({
    title, body,
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: confirm, kind: 'primary', submit: true, value: () => input.value.trim() }],
    onOpen: () => setTimeout(() => input.select(), 0),
  });
  return result || null;
}

export async function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  const result = await modal({
    title,
    body: h('p', { class: 'modal-text', text: message }),
    actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: confirm, value: true, kind: danger ? 'danger' : 'primary', submit: true }],
  });
  return result === true;
}

/**
 * Popup shown when someone tries to open (kind 'open') or download (kind 'download')
 * something they have no permission for. Shows the owner's email so they can ask.
 */
/** what (downloads only): 'document', 'folder' or 'all', for the wording. */
export async function noAccessDialog({ kind = 'open', name, owner, contact, canPreview = false, what = 'document' }) {
  const download = kind === 'download';
  const OFF = { document: 'This document is disabled for download.', folder: 'This folder is disabled for download.', all: 'These files are disabled for download.' };
  const choice = await modal({
    title: download ? 'Download disabled' : 'Locked',
    body: h('div', { class: 'modal-center' },
      h('div', { class: `locked-art${download ? ' nodl' : ''}` }, icon(download ? 'download-off' : 'lock', 30)),
      download && what !== 'all' && h('p', { class: 'modal-name', text: name }),
      h('p', { class: 'modal-text', text: download
        ? `${OFF[what] || OFF.document}${canPreview ? ' You can still preview it.' : ''}`
        : `You don't have access to “${name}”.` }),
      contact
        ? [h('p', { class: 'hint', text: `Email ${owner || 'the owner'} if you need it:` }),
          h('a', { class: 'access-mail', href: `mailto:${contact}` }, icon('send', 14), h('span', { text: contact }))]
        : owner && h('p', { class: 'hint', text: `Ask ${owner} if you need it.` })),
    actions: [
      ...(contact ? [{ label: 'Copy email', value: 'copy', kind: 'ghost', icon: 'copy' }] : []),
      { label: 'OK', value: true, kind: 'primary', submit: true },
    ],
  });
  if (choice === 'copy') copyText(contact, 'Email copied');
}

// ---------- Pop-up menu ----------

let openMenu = null;
export function popMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'popmenu', role: 'menu' });
  for (const it of items) {
    menu.append(h('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: () => { closeMenu(); it.onClick(); },
    }, icon(it.icon, 16), h('span', { text: it.label })));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))}px`;
  openMenu = menu;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  menu.querySelector('button')?.focus();
}

function outside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
  document.removeEventListener('mousedown', outside);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('resize', closeMenu);

export async function copyText(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`);
  } catch {
    toast('Could not reach the clipboard. Copy it by hand.', 'error');
  }
}
