// Preview panel: PDFs (pdf.js), HTML notes (sandboxed iframe), images and plain text.
import { h, icon, btn, modal } from './ui.js';

export const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
export const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const MIME = {
  pdf: 'application/pdf', html: 'text/html', htm: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
};
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const TEXT = new Set(['txt', 'md', 'csv', 'json']);

export const extOf = (name) => (name.match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        scripts.delete(src);
        reject(new Error('Could not load a viewer component. Check your connection and try again.'));
      };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export function saveBytes(name, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || mimeOf(name) }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** entries: [{ path, read: () => Promise<Uint8Array> }] */
export async function zipFiles(entries, onProgress) {
  await loadScript(JSZIP);
  const zip = new window.JSZip();
  let i = 0;
  for (const e of entries) {
    onProgress?.(++i, entries.length);
    zip.file(e.path, await e.read());
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

// Put in front of an HTML note whose download is turned off: no right-click menu, no printing.
const NO_SAVE_HTML = '<script>document.addEventListener("contextmenu",function(e){e.preventDefault()},true)</script>'
  + '<style>@media print{html{display:none!important}}</style>';

const blockMenu = (e) => e.preventDefault();

function setNoSave(body, on) {
  document.body.classList.toggle('no-print', on);
  body.classList.toggle('no-save', on);
  if (on) body.addEventListener('contextmenu', blockMenu);
}

const SUGGESTIONS = ['Summarise this document', 'Explain the key ideas simply', 'Make 5 quiz questions'];

/** Popup shown while the assistant is not connected yet. */
function assistantSoon() {
  return modal({
    title: 'Coming soon',
    body: h('div', { class: 'modal-center' },
      h('div', { class: 'locked-art ai' }, icon('sparkle', 30)),
      h('p', { class: 'modal-text', text: 'The AI assistant is not open yet.' }),
      h('p', { class: 'hint', text: 'Soon it will summarise notes, explain ideas and make quiz questions. Check back later!' })),
    actions: [{ label: 'OK', value: true, kind: 'primary', submit: true }],
  });
}

export class Viewer {
  /** ask(fileId, messages): Promise<{ text }> – when given, opened files get the AI assistant. */
  constructor(root, { onOpen, onClose, ask } = {}) {
    this.root = root;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.ask = ask;
    // The assistant conversation of the open file:
    // { path, id, name, open, busy, items: [{ role: 'user'|'assistant'|'note', text, failed? }] }
    this.chat = null;
    this.token = 0;
    this.path = null;
    this.full = false;
    this.last = null;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.full && !document.querySelector('.backdrop')) this.setFull(false);
    });
  }

  /** Expanded preview: it fills the browser window (the browser itself stays as it is). */
  setFull(on) {
    if (on === this.full) return;
    this.full = on;
    this.root.classList.toggle('pv-full', on);
    document.body.classList.toggle('pv-full-open', on);
    const b = this.root.querySelector('.pv-full-btn');
    if (b) b.replaceWith(this.#fullButton());
    // PDF pages are drawn for a width, so draw them again at the new size.
    setTimeout(() => this.#redraw(), 50);
  }

  #fullButton() {
    const b = btn(this.full ? 'Back to normal size' : 'Fill the window', () => this.setFull(!this.full), { kind: 'icon', iconName: this.full ? 'shrink' : 'expand' });
    b.classList.add('pv-full-btn');
    return b;
  }

  async #redraw() {
    const last = this.last;
    if (!last || last.path !== this.path || extOf(last.name) !== 'pdf') return;
    const before = this.root.querySelector('.pv-body');
    const ratio = before && before.scrollHeight ? before.scrollTop / before.scrollHeight : 0;
    await this.show(last);
    const after = this.root.querySelector('.pv-body');
    if (after) after.scrollTop = ratio * after.scrollHeight;
  }

  #frame(title, onDownload, idEl, downloadButton, aiButton) {
    this.root.replaceChildren();
    this.root.hidden = false;
    const head = h('div', { class: 'pv-head' },
      btn('Close preview', () => this.hide(), { kind: 'icon', iconName: 'x' }),
      h('div', { class: 'pv-title', title, text: title }),
      idEl,
      aiButton,
      this.#fullButton(),
      downloadButton ? downloadButton('Download', 'soft') : onDownload && btn('Download', onDownload, { kind: 'soft', iconName: 'download' }),
    );
    const body = h('div', { class: 'pv-body' });
    this.root.append(head, body);
    this.onOpen?.();
    return body;
  }

  loading(path) {
    this.token++;
    this.path = path;
    const name = path.split('/').pop();
    const body = this.#frame(name);
    body.append(h('div', { class: 'pv-msg' }, h('span', { class: 'spinner' }), 'Opening…'));
  }

  /**
   * noSave: downloading is turned off, so also discourage right-click saving, dragging and printing.
   * offButton(label, kind): makes the greyed-out Download button shown when noSave is set.
   */
  async show(args) {
    const { name, path, bytes, onDownload, noSave = false, id, offButton } = args;
    const t = ++this.token;
    this.path = path;
    this.last = args;
    const off = noSave && offButton ? offButton : null;
    const withAi = !!(this.ask && id);
    if (!withAi || this.chat?.path !== path) this.chat = withAi ? { path, id, name, open: false, items: [] } : null;
    const aiButton = withAi && this.#aiButton();
    const body = this.#frame(name, onDownload, id && this.idChip?.(id), off, aiButton);
    setNoSave(body, noSave);
    if (this.chat?.open) this.#renderChat();
    const ext = extOf(name);
    if (ext === 'pdf') {
      await this.#pdf(bytes, body, t);
    } else if (ext === 'html' || ext === 'htm') {
      // Opaque origin: the note's scripts can run but cannot touch this page or its storage.
      const f = h('iframe', { sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: name });
      f.srcdoc = (noSave ? NO_SAVE_HTML : '') + new TextDecoder().decode(bytes);
      body.classList.add('frame');
      body.append(f);
    } else if (IMAGES.has(ext)) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }));
      const img = h('img', { class: 'pv-img', alt: name, src: url, draggable: noSave ? 'false' : null, onload: () => URL.revokeObjectURL(url) });
      body.append(img);
    } else if (TEXT.has(ext)) {
      body.append(h('pre', { class: 'pv-text', text: new TextDecoder().decode(bytes) }));
    } else {
      // Word, PowerPoint, zip and so on: the browser cannot show them.
      body.append(h('div', { class: 'pv-unsupported' },
        h('div', { class: 'pv-art' }, icon('file', 26), h('b', { text: (ext || 'file').toUpperCase().slice(0, 4) })),
        h('h3', { text: 'Unsupported document' }),
        h('p', { class: 'modal-text', text: noSave
          ? 'This file type cannot be previewed here, and downloading it is turned off.'
          : 'This file type cannot be previewed here. Download it to view it.' }),
        off ? off('Download', 'primary') : onDownload && btn('Download', onDownload, { kind: 'primary', iconName: 'download' })));
    }
  }

  error(message) {
    const body = this.#frame('Could not open');
    body.append(h('div', { class: 'pv-msg err' }, icon('x', 18), message));
  }

  hide() {
    if (this.full) this.setFull(false);
    this.token++;
    this.path = null;
    this.last = null;
    this.chat = null;
    document.body.classList.remove('no-print');
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onClose?.();
  }

  // ---------- AI assistant ----------

  #aiButton() {
    const b = btn('Ask AI', () => this.#toggleChat(), { kind: 'soft', iconName: 'sparkle', title: 'Ask the AI assistant about this document' });
    b.classList.add('pv-ai-btn');
    b.setAttribute('aria-pressed', this.chat?.open ? 'true' : 'false');
    return b;
  }

  #toggleChat(open = !this.chat?.open) {
    if (!this.chat) return;
    this.chat.open = open;
    this.root.querySelector('.pv-ai-btn')?.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) {
      this.#renderChat();
      this.root.querySelector('.ai-input')?.focus();
    } else {
      this.root.querySelector('.ai-panel')?.remove();
    }
  }

  /** Draw the assistant panel from this.chat (again after a redraw of the preview). */
  #renderChat() {
    const chat = this.chat;
    this.root.querySelector('.ai-panel')?.remove();
    const log = h('div', { class: 'ai-log', role: 'log', 'aria-live': 'polite' });
    const input = h('textarea', {
      class: 'ai-input', rows: 1, maxlength: 2000, placeholder: 'Ask about this document…', 'aria-label': 'Question for the AI assistant',
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send(input.value);
        }
      },
      oninput: () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      },
    });
    const sendBtn = btn('Send', () => send(input.value), { kind: 'icon', iconName: 'send' });
    sendBtn.classList.add('ai-send');

    const draw = () => {
      const busy = !!chat.busy;
      log.replaceChildren();
      if (!chat.items.length) {
        log.append(h('div', { class: 'ai-intro' },
          h('span', { class: 'ai-mark' }, icon('sparkle', 22)),
          h('p', { class: 'ai-hello', text: 'Hi! Ask me anything about' }),
          h('p', { class: 'ai-doc', text: chat.name }),
          h('div', { class: 'ai-chips' }, SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'ai-chip', onclick: () => send(s) }, s)))));
      }
      for (const it of chat.items) {
        log.append(h('div', { class: `ai-msg ${it.role}${it.failed ? ' failed' : ''}`, text: it.text }));
      }
      if (busy) log.append(h('div', { class: 'ai-msg assistant typing', 'aria-label': 'The assistant is thinking' }, h('i'), h('i'), h('i')));
      log.scrollTop = log.scrollHeight;
      input.disabled = busy;
      sendBtn.disabled = busy;
    };

    const send = async (raw) => {
      const text = raw.trim().slice(0, 2000);
      if (!text || input.disabled) return;
      input.value = '';
      input.style.height = 'auto';
      const asked = { role: 'user', text };
      chat.items.push(asked);
      chat.busy = true;
      draw();
      const messages = chat.items.filter((m) => !m.failed && m.role !== 'note').map(({ role, text: t }) => ({ role, text: t }));
      // The preview may have been drawn again meanwhile (for example by Fill the window).
      const refresh = () => {
        if (this.chat !== chat || !chat.open) return;
        if (log.isConnected) draw();
        else this.#renderChat();
      };
      let soon = false;
      try {
        const answer = await this.ask(chat.id, messages);
        chat.items.push({ role: 'assistant', text: String(answer?.text || '') });
      } catch (e) {
        asked.failed = true;
        soon = e.code === 'assistant_unavailable';
        chat.items.push({ role: 'note', text: soon ? 'The AI assistant is not open yet.' : e.message || 'Something went wrong. Try again.' });
      }
      chat.busy = false;
      if (this.chat !== chat) return;
      refresh();
      if (soon) await assistantSoon();
      if (this.chat === chat && chat.open) this.root.querySelector('.ai-input')?.focus();
    };

    const panel = h('aside', { class: 'ai-panel', 'aria-label': 'AI assistant' },
      h('div', { class: 'ai-head' },
        h('span', { class: 'ai-mark sm' }, icon('sparkle', 16)),
        h('b', { text: 'AI assistant' }),
        h('span', { class: 'ai-badge', text: 'Preview' }),
        btn('Close the assistant', () => this.#toggleChat(false), { kind: 'icon', iconName: 'x' })),
      log,
      h('div', { class: 'ai-compose' }, input, sendBtn),
      h('p', { class: 'ai-foot', text: 'AI answers can be wrong. Check them against the notes.' }));
    this.root.append(panel);
    draw();
  }

  async #pdf(bytes, body, t) {
    const status = h('div', { class: 'pv-msg' }, h('span', { class: 'spinner' }), 'Rendering…');
    const wrap = h('div', { class: 'pdf-pages' });
    body.append(status, wrap);
    await loadScript(PDFJS);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;
    status.remove();
    const width = Math.max(Math.min((body.clientWidth || 800) - 32, this.full ? 1600 : 1100), 260);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        if (t !== this.token) return;
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: width / base.width });
        const c = h('canvas', { 'aria-label': `Page ${i} of ${doc.numPages}` });
        c.width = Math.floor(vp.width * dpr);
        c.height = Math.floor(vp.height * dpr);
        c.style.width = `${Math.floor(vp.width)}px`;
        wrap.append(c);
        await page.render({
          canvasContext: c.getContext('2d'),
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
        }).promise;
      }
    } finally {
      if (t !== this.token) doc.destroy();
    }
  }
}
