// Documents tab: PDF/text/code reading with pdf.js (UMD build), text extraction, AI hand-off
// v2.1.0: code files welcome, binary files rejected with a clear message,
//        scanned-PDF warning, clean hand-off of several documents to Chat.
const Docs = {
  pdfDoc: null,
  fileName: '',
  extracted: '',
  lib() { return window.pdfjsLib || null; },

  async init() {
    el('btn-open-pdf').onclick = () => el('docs-file-input').click();
    el('docs-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await this.open(file);
    });
    el('btn-doc-extract').onclick = () => this.extract();
    el('btn-doc-summarize').onclick = () => this.sendToChat();
    if (!this.lib()) console.warn('pdf.js not loaded');
  },

  async open(file) {
    this.fileName = file.name;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      await this.openPdf(file);
    } else {
      const text = await file.text();
      if (this.looksBinary(text)) {
        this.reset();
        toast('“' + file.name + '” is a binary file. Supported: PDF, text, markdown, code and data files.', 'err');
        return;
      }
      this.showText(text);
    }
  },

  looksBinary(text) {
    const sample = text.slice(0, 4000);
    if (!sample.length) return false;
    let bad = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad++;
      else if (c === 0xFFFD) bad++;
    }
    return (bad / sample.length) > 0.02;
  },

  reset() {
    this.pdfDoc = null;
    this.rawBuf = null;
    this.extracted = '';
    el('doc-stats').textContent = 'No document loaded.';
    el('btn-doc-extract').disabled = true;
    el('btn-doc-extract').textContent = '📝 Extract text';
    el('btn-doc-summarize').disabled = true;
    el('doc-extracted').textContent = '';
    el('docs-viewer').innerHTML = '<div class="empty">Open a PDF, text or code file to read it here.<br><small>Extract its text and ask the AI about it in Chat.</small></div>';
  },

  async openPdf(file) {
    const lib = this.lib();
    if (!lib) return toast('PDF engine failed to load — reinstall the app', 'err');
    try {
      const buf = await file.arrayBuffer();
      this.rawBuf = new Uint8Array(buf);
      this.pdfDoc = await lib.getDocument({ data: this.rawBuf.slice() }).promise;
      this.extracted = '';
      el('doc-stats').textContent = this.fileName + ' — ' + this.pdfDoc.numPages + ' pages';
      el('btn-doc-extract').disabled = false;
      el('btn-doc-extract').textContent = '📝 Extract text';
      el('btn-doc-summarize').disabled = false;
      el('doc-extracted').textContent = '';
      const viewer = el('docs-viewer');
      viewer.innerHTML = '';
      const n = Math.min(this.pdfDoc.numPages, 10);
      for (let i = 1; i <= n; i++) {
        const page = await this.pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: 1.35 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.maxWidth = '100%';
        canvas.style.margin = '12px auto';
        canvas.style.display = 'block';
        canvas.style.background = '#fff';
        canvas.style.boxShadow = '0 2px 12px rgba(0,0,0,.25)';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        viewer.appendChild(canvas);
      }
      if (this.pdfDoc.numPages > n) {
        viewer.appendChild(h('div', 'hint', '… ' + (this.pdfDoc.numPages - n) + ' more pages (use Extract text for the full content)'));
      }
      toast('PDF opened: ' + this.pdfDoc.numPages + ' pages', 'ok');
    } catch (e) {
      this.reset();
      toast('Could not open PDF: ' + (e.message || e), 'err');
    }
  },

  showText(text) {
    this.pdfDoc = null;
    this.rawBuf = null;
    this.extracted = text;
    el('doc-stats').textContent = this.fileName + ' — ' + text.length.toLocaleString() + ' characters';
    el('btn-doc-extract').disabled = true;
    el('btn-doc-extract').textContent = '✔ Text loaded';
    el('btn-doc-summarize').disabled = false;
    el('doc-extracted').textContent = '';
    const viewer = el('docs-viewer');
    viewer.innerHTML = '';
    const wrap = h('div', 'doc-text');
    wrap.textContent = text.slice(0, 200000);
    viewer.appendChild(wrap);
    toast('Document opened: ' + text.length.toLocaleString() + ' characters', 'ok');
  },

  async extractPdfText(arrayBuffer) {
    const lib = this.lib();
    if (!lib) return '';
    try {
      const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
      let out = '';
      const n = Math.min(pdf.numPages, 300);
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const parts = [];
        let lastY = null;
        for (const item of tc.items) {
          if (item.str === undefined) continue;
          const y = Math.round(item.transform[5]);
          if (lastY !== null && Math.abs(y - lastY) > 3) parts.push('\n');
          parts.push(item.str);
          lastY = y;
        }
        out += '\n\n--- Page ' + i + ' ---\n' + parts.join('');
      }
      return out.trim();
    } catch (e) {
      console.warn('pdf extract failed', e);
      return '';
    }
  },

  async extract() {
    if (!this.pdfDoc) return;
    const btn = el('btn-doc-extract');
    btn.disabled = true;
    btn.textContent = '⏳ Extracting…';
    const text = await this.extractPdfText(this.rawBuf.slice());
    this.extracted = text;
    if (!text || text.replace(/\s/g, '').length < 40) {
      el('doc-extracted').textContent = '';
      el('doc-stats').textContent = this.fileName + ' — no text layer found';
      btn.textContent = '📝 Extract text';
      btn.disabled = false;
      toast('This PDF has no extractable text (scanned images). Export its pages as images and attach them in Chat with a vision model.', 'err');
      return;
    }
    el('doc-extracted').textContent = text.slice(0, 3000) + (text.length > 3000 ? '\n… (' + text.length.toLocaleString() + ' chars total)' : '');
    el('doc-stats').textContent = this.fileName + ' — extracted ' + text.length.toLocaleString() + ' characters';
    btn.textContent = '✔ Extracted';
    toast('Text extracted — now “Ask AI about this document”', 'ok');
  },

  async sendToChat() {
    if (!this.extracted) { toast('Extract the text first'); return; }
    document.querySelector('[data-tab="chat"]').click();
    Chat.attachedDocs.push({ name: this.fileName, text: this.extracted });
    Chat.renderAttachments();
    toast('“' + this.fileName + '” attached in Chat (' + this.extracted.length.toLocaleString() + ' chars) — type your question and press Send');
  }
};
window.Docs = Docs;
