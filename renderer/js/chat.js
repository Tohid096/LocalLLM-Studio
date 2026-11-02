// Chat tab: conversations, streaming responses, image attach (VLM), doc/code context
// v2.2.1:
//  - messages use the FULL chat width (no more 60% column after formatting kicks in)
//  - streaming markdown re-render throttled to ~10 fps (smooth on long code answers)
//  - rendered HTML is cached per message: finishing a reply no longer re-highlights the whole chat
//  - speed line (tok/s · seconds) under each finished answer
// v2.2.0:
//  - prompt is auto-fitted to the model context (oldest turns dropped, docs budgeted) so
//    "request exceeds context" errors disappear instead of killing the reply
//  - Continue button: finishes a truncated answer WITHOUT starting over
//  - Regenerate replaces only the last answer (no full restart)
//  - code blocks are syntax highlighted with a Copy button
//  - image attach warns when the model has no vision projector
const Chat = {
  models: [],           // all usable chat/vision models (installed + custom)
  conversations: [],    // [{id, title, messages: [{role, content, images:[dataUrl], docs:[{name,text}], finish}]}]
  current: null,
  attachedImages: [],   // [{name, dataUrl}]
  attachedDocs: [],     // [{name, text}] - documents & code files as context
  generating: false,
  streamingBubble: null,
  pinnedToBottom: true,
  _mdCache: new WeakMap(),   // message object -> { src, html } rendered-markdown cache

  async init() {
    this.listenTokens();
    el('btn-new-chat').onclick = () => this.newChat();
    el('btn-send').onclick = () => this.send();
    el('btn-stop').onclick = () => this.stop();
    el('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    el('file-image').addEventListener('change', (e) => this.onPickImages(e));
    el('file-doc').addEventListener('change', (e) => this.onPickDocs(e));
    el('btn-chat-model').onclick = () => this.toggleModel();
    el('chat-model-select').onchange = () => this.updateChip();
    // message action buttons (copy / regenerate / continue) - delegated
    el('messages').addEventListener('click', (e) => {
      const btn = e.target.closest('.msg-act');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'copy') return this.copyMessage(btn);
      if (act === 'regen') return this.regenerate();
      if (act === 'continue') return this.continueLast();
    });
    // stop autoscroll from hijacking the reading position
    el('messages').addEventListener('scroll', () => {
      const b = el('messages');
      this.pinnedToBottom = (b.scrollHeight - b.scrollTop - b.clientHeight) < 80;
    });
    this.pinnedToBottom = true;
    this.conversations = JSON.parse(localStorage.getItem('llm-chats') || '[]');
    this.renderChatList();
    if (!this.conversations.length) this.newChat();
    else this.openChat(this.conversations[0].id);
    this.refreshModels();
    window.addEventListener('models-changed', () => this.refreshModels());
  },

  listenTokens() {
    // throttle live re-renders to ~10 fps: mdToHtml() on every frame is the single
    // biggest renderer CPU cost on long answers, and 90 ms is still fluid to read
    const RENDER_MS = 90;
    let pending = false;
    let lastRender = 0;
    window.api.on('chat-token', (d) => {
      const bub = this.streamingBubble;
      if (!bub || !bub.isConnected) return;
      bub.dataset.buf += d.text;
      if (pending) return;
      pending = true;
      const wait = Math.max(0, RENDER_MS - (Date.now() - lastRender));
      setTimeout(() => {
        pending = false;
        lastRender = Date.now();
        const b = this.streamingBubble;
        if (!b || !b.isConnected) return;
        b.innerHTML = mdToHtml(b.dataset.buf, { live: true }) + '<span class="cursor"></span>';
        this.scrollDown();
      }, wait);
    });
    window.api.on('llama-status', () => this.updateChip());
  },

  async refreshModels() {
    const list = await window.api.modelsList();
    const models = [
      ...list.chat.filter(m => m.installed),
      ...list.vision.filter(m => m.installed),
      ...(list.custom || [])
    ];
    this.models = models;
    const sel = el('chat-model-select');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option');
      o.value = m.id;
      const vTag = m.category === 'vision' ? ' 👁' : '';
      o.textContent = (m.name || m.id) + vTag;
      sel.appendChild(o);
    }
    if (!models.length) {
      const o = document.createElement('option');
      o.textContent = 'No models installed yet';
      o.value = '';
      sel.appendChild(o);
    }
    if (prev && models.some(m => m.id === prev)) sel.value = prev;
    this.updateChip();
  },

  currentModel() {
    const id = el('chat-model-select').value;
    return this.models.find(m => m.id === id) || null;
  },

  async updateChip() {
    const m = this.currentModel();
    const chip = el('chat-model-chip');
    const st = await window.api.llamaStatus();
    if (st.running && st.model && st.model.id === (m && m.id)) {
      const gpu = st.ngl === 0 ? ' · CPU' : (st.ngl != null && st.ngl < 99 ? ' · ' + st.ngl + ' GPU layers' : '');
      chip.textContent = 'running' + (st.hasMmproj ? ' · vision ready' : '') + (st.ctx ? ' · ' + (st.ctx / 1024).toFixed(0) + 'K ctx' : '') + gpu;
      chip.className = 'chip good';
      el('btn-chat-model').textContent = '⏹';
    } else if (st.running) {
      chip.textContent = 'another model is loaded';
      chip.className = 'chip warn';
      el('btn-chat-model').textContent = '⏹';
    } else {
      chip.textContent = m ? ('loaded: none · ' + (m.category === 'vision' ? 'vision model' : 'chat model')) : 'no model selected';
      chip.className = 'chip';
      el('btn-chat-model').textContent = '⏻';
    }
  },

  async toggleModel() {
    const st = await window.api.llamaStatus();
    if (st.running) {
      await window.api.stopLLM();
      toast('Model unloaded', 'ok');
      this.updateChip();
      return;
    }
    const m = this.currentModel();
    if (!m) return toast('Install a model from the Models tab first');
    await this.loadModel(m);
  },

  async loadModel(m) {
    toast('Loading ' + m.name + (m.category === 'vision' ? ' (with vision projector)…' : '…'));
    const opts = {
      modelPath: m.modelPath || m.sourcePath,
      mmprojPath: m.mmprojPath || null,
      modelInfo: { id: m.id, name: m.name },
      ctxSize: undefined
    };
    if (!opts.modelPath && m.sourcePath) opts.modelPath = m.sourcePath;
    const r = await window.api.startLLM(opts);
    if (r.ok) {
      if (r.retried) {
        // GPU ran out of memory and we fell back automatically
        toast(m.name + ' ready — GPU memory was tight, so ' + (r.ngl === 0 ? 'it runs on the CPU' : r.ngl + ' of its layers run on the iGPU') + '. It still works; use a smaller quant or close GPU apps for full speed.', '');
      } else {
        toast(m.name + ' ready' + (m.category === 'vision' ? ' — attach images! 🖼' : ''), 'ok');
      }
    } else {
      toast('Load failed: ' + r.error, 'err');
    }
    this.updateChip();
    return r.ok;
  },

  // make sure the engine is running the model the user selected (shared with Projects)
  async ensureEngine() {
    const st = await window.api.llamaStatus();
    if (st.running && st.model && st.model.id === (this.currentModel() && this.currentModel().id)) return true;
    const m = this.currentModel();
    if (!m) { toast('Select a model first (Models tab → install → pick here)'); return false; }
    if (st.running && st.model && st.model.id === m.id) return true;
    return await this.loadModel(m);
  },

  // ---------- conversations ----------
  newChat() {
    const c = { id: 'c' + Date.now(), title: 'New chat', messages: [], createdAt: Date.now() };
    this.conversations.unshift(c);
    this.openChat(c.id);
    this.save();
  },
  openChat(id) {
    this.current = id;
    this.pinnedToBottom = true;
    this.renderChatList();
    this.renderMessages();
  },
  deleteChat(id) {
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.current === id) { if (this.conversations.length) this.openChat(this.conversations[0].id); else this.newChat(); }
    this.save();
  },
  // quota-safe persistence: images are the heavy part, drop them first if needed
  save() {
    const data = JSON.stringify(this.conversations.slice(0, 40));
    try { localStorage.setItem('llm-chats', data); return; } catch (e) {}
    try {
      const slim = this.conversations.slice(0, 40).map(c => ({
        ...c,
        messages: c.messages.map(m => (m.images && m.images.length) ? { ...m, images: [] } : m)
      }));
      localStorage.setItem('llm-chats', JSON.stringify(slim));
      console.warn('chat history saved without images (storage quota)');
    } catch (e) {
      console.warn('could not save chat history', e);
    }
  },
  renderChatList() {
    const list = el('chat-list');
    list.innerHTML = '';
    for (const c of this.conversations) {
      const item = h('div', 'chat-item' + (c.id === this.current ? ' active' : ''), esc(c.title || 'New chat'));
      item.onclick = () => this.openChat(c.id);
      item.oncontextmenu = (e) => { e.preventDefault(); this.deleteChat(c.id); };
      list.appendChild(item);
    }
  },
  conv() { return this.conversations.find(c => c.id === this.current); },

  renderMessages() {
    const box = el('messages');
    box.innerHTML = '';
    const c = this.conv();
    if (!c) return;
    if (!c.messages.length) {
      box.appendChild(h('div', 'empty', 'Start chatting!<br><small>Install a model in the Models tab, press ⏻ to load it, then type below.<br>Vision models 👁 read images; 📎 attaches documents & code files.</small>'));
      return;
    }
    for (const m of c.messages) this.renderMsg(m);
    this.scrollDown(true);
  },

  // rendered markdown with per-message caching: a redraw after generation only
  // highlights NEW content instead of re-parsing the whole conversation
  renderedHtml(m) {
    const c = this._mdCache.get(m);
    if (c && c.src === m.content) return c.html;
    const html = mdToHtml(m.content || '');
    this._mdCache.set(m, { src: m.content, html });
    return html;
  },

  // returns the bubble element (streaming writes into it)
  renderMsg(m, opts = {}) {
    const box = el('messages');
    const div = h('div', 'msg ' + (m.role === 'user' ? 'user' : 'ai'));
    const av = h('div', 'avatar', m.role === 'user' ? '🧑' : '✦');
    // body column: keeps the bubble at FULL row width and holds the footer row
    const body = h('div', 'msg-body');
    const bub = h('div', 'bubble');
    for (const img of (m.images || [])) {
      const im = document.createElement('img');
      im.src = img; im.className = 'att';
      bub.appendChild(im);
    }
    for (const d of (m.docs || [])) {
      bub.appendChild(h('div', 'doc-chip', '📄 ' + esc(d.name)));
    }
    if (m.stopped) bub.appendChild(h('div', 'stopped-note', '⏹ ' + (m.stopNote || 'stopped by user — partial reply kept').replace(/^(⏹|⚠️|⏳)\s*/, '')));
    if (m.finish === 'length' && !m.error) bub.appendChild(h('div', 'stopped-note warn-note', '⏳ hit the Max-new-tokens limit — press ▶ Continue to finish this answer (nothing is repeated), or raise “Max new tokens” in Settings → Generation'));
    const span = h('span', 'md', opts.streaming ? '' : this.renderedHtml(m));
    bub.appendChild(span);
    body.appendChild(bub);
    div.appendChild(av); div.appendChild(body);

    // footer row: speed meta (always visible) + per-message actions (on hover)
    if (!opts.streaming) {
      const foot = h('div', 'msg-foot');
      if (m.role === 'assistant' && !m.error && m.meta) foot.appendChild(h('span', 'msg-meta', esc(m.meta)));
      const acts = h('div', 'msg-acts');
      if (m.role === 'assistant' && !m.error) {
        acts.appendChild(this.actBtn('copy', '⧉ Copy', 'Copy the whole answer'));
        const c = this.conv();
        const isLast = c && c.messages[c.messages.length - 1] === m;
        if (isLast) {
          acts.appendChild(this.actBtn('regen', '↻ Regenerate', 'Replace this answer with a fresh one (keeps the conversation)'));
          acts.appendChild(this.actBtn('continue', '▶ Continue', 'Finish this answer — continues from where it stopped, nothing is repeated'));
        }
      } else if (m.role === 'user') {
        acts.appendChild(this.actBtn('copy', '⧉ Copy', 'Copy this message'));
      }
      if (acts.children.length) foot.appendChild(acts);
      if (foot.children.length) body.appendChild(foot);
    }
    box.appendChild(div);
    return bub;
  },
  actBtn(act, label, title) {
    const b = h('button', 'msg-act', esc(label));
    b.dataset.act = act;
    b.title = title || '';
    return b;
  },
  copyMessage(btn) {
    const msg = btn.closest('.msg');
    const bubble = msg && msg.querySelector('.bubble .md');
    if (!bubble) return;
    copyText(bubble.textContent || '').then(() => {
      const old = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = old; }, 1200);
    });
  },
  // only force-scroll when the user is (or wants to be) at the bottom
  scrollDown(force) {
    const b = el('messages');
    if (!b) return;
    if (force || this.pinnedToBottom) b.scrollTop = b.scrollHeight;
  },

  // ---------- attachments ----------
  async onPickImages(e) {
    const m = this.currentModel();
    for (const file of e.target.files) {
      try {
        const dataUrl = await this.fileToDataUrl(file);
        this.attachedImages.push({ name: file.name, dataUrl });
      } catch (err) {
        toast('Could not read image ' + file.name, 'err');
      }
    }
    e.target.value = '';
    if (this.attachedImages.length && m && m.category !== 'vision' && !m.mmprojPath) {
      toast('Heads-up: ' + (m.name || 'this model') + ' cannot see images. They will be mentioned but not viewed — pick a 👁 vision model from the dropdown for real image understanding.', '');
    }
    this.renderAttachments();
  },
  async onPickDocs(e) {
    for (const file of e.target.files) {
      await this.attachDocFile(file);
    }
    e.target.value = '';
    this.renderAttachments();
  },
  async attachDocFile(file) {
    if (file.size > 200 * 1024 * 1024) { toast(file.name + ' is too large (200 MB limit)', 'err'); return; }
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const text = await Docs.extractPdfText(await file.arrayBuffer());
        if (!text || text.replace(/\s/g, '').length < 40) {
          toast('“' + file.name + '” has no text layer (scanned images?). Attach page screenshots as images with a vision model instead.', 'err');
          return;
        }
        this.attachedDocs.push({ name: file.name, text });
        toast('PDF attached: ' + text.length.toLocaleString() + ' chars of text');
      } else {
        const text = await file.text();
        if (this.looksBinary(text)) {
          toast('“' + file.name + '” looks like a binary file. Supported: PDF, text, markdown, code, data files.', 'err');
          return;
        }
        if (!text.trim()) { toast('“' + file.name + '” is empty', 'err'); return; }
        this.attachedDocs.push({ name: file.name, text });
        toast('Attached “' + file.name + '”: ' + text.length.toLocaleString() + ' chars');
      }
    } catch (err) {
      toast('Could not read ' + file.name + ': ' + (err.message || err), 'err');
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
  // downscale to max 1024px / JPEG for fast VLM input and small storage footprint
  fileToDataUrl(file) {
    return new Promise(async (res, rej) => {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height, 1));
        if (scale === 1 && file.size < 400 * 1024) {
          const r2 = new FileReader();
          r2.onload = () => res(r2.result);
          r2.onerror = rej;
          r2.readAsDataURL(file);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        res(canvas.toDataURL('image/jpeg', 0.85));
      } finally { URL.revokeObjectURL(url); }
    });
  },
  renderAttachments() {
    const strip = el('attach-strip');
    strip.innerHTML = '';
    for (const a of this.attachedImages) {
      const pill = h('div', 'attach-pill');
      const im = document.createElement('img'); im.src = a.dataUrl;
      pill.appendChild(im);
      pill.appendChild(h('span', '', esc(a.name)));
      const x = h('span', 'x', '✕');
      x.onclick = () => { this.attachedImages = this.attachedImages.filter(i => i !== a); this.renderAttachments(); };
      pill.appendChild(x);
      strip.appendChild(pill);
    }
    for (const d of this.attachedDocs) {
      const pill = h('div', 'attach-pill', '📄 ' + esc(d.name) + ' · ' + d.text.length.toLocaleString() + ' chars · ~' + estTokens(d.text).toLocaleString() + ' tok');
      const x = h('span', 'x', '✕');
      x.onclick = () => { this.attachedDocs = this.attachedDocs.filter(i => i !== d); this.renderAttachments(); };
      pill.appendChild(x);
      strip.appendChild(pill);
    }
  },

  // ---------- prompt building: fit the model's context, budget the docs ----------
  // Returns { messages, trimmed, estPromptTokens }
  buildApiMessages(c, opts = {}) {
    const settings = opts.settings || { ctxSize: 8192, maxTokens: 2048, docContextChars: 16000, systemPrompt: '' };
    const ctx = opts.ctx || settings.ctxSize || 8192;
    const reserve = (settings.maxTokens || 2048) + 320;             // room for the answer + overhead
    const budget = Math.max(512, Math.floor((ctx - reserve) * (opts.squeeze || 1))); // tokens the prompt may use
    const docCapChars = Math.max(1000, parseInt(settings.docContextChars, 10) || 16000);

    const hist = c.messages.filter(m => !m.error).slice(-60);
    if (!hist.length) return { messages: [], trimmed: false, estPromptTokens: 0 };

    // base cost of each message WITHOUT doc text (~700 tok per image for the vision encoder)
    const base = hist.map(m => estTokens(m.content || '') + ((m.images || []).length) * 700);

    // include messages newest → oldest, keeping ~45% of the budget free for attached docs
    let used = 24;
    let start = hist.length;
    while (start > 0) {
      const i = start - 1;
      if (start < hist.length && used + base[i] > Math.floor(budget * 0.55)) break;
      used += base[i];
      start--;
    }

    // newest message that still carries documents gets the doc text
    let docIdx = -1;
    for (let i = hist.length - 1; i >= start; i--) if (hist[i].docs && hist[i].docs.length) { docIdx = i; break; }

    // doc room: what is left of the budget (and never more than the user's setting)
    const docRoomTokens = Math.max(0, budget - used - 80);
    const docRoomChars = Math.min(docCapChars, Math.floor(docRoomTokens * 3.6));

    const out = [];
    let sysPrompt = settings.systemPrompt || '';
    if (start > 0) sysPrompt += (sysPrompt ? '\n\n' : '') + '[Note: some older conversation turns were omitted automatically so the request fits the model context window.]';
    if (sysPrompt) out.push({ role: 'system', content: sysPrompt });

    for (let i = start; i < hist.length; i++) {
      const msg = hist[i];
      let content = msg.content || '';
      if (msg.docs && msg.docs.length) {
        if (i === docIdx) {
          const per = Math.max(500, Math.floor(docRoomChars / msg.docs.length));
          for (const d of msg.docs) {
            const truncated = d.text.length > per;
            const t = truncated ? d.text.slice(0, per) : d.text;
            content += '\n\n[Attached document: ' + d.name + ']\n"""\n' + t + '\n"""'
              + (truncated ? '\n[document truncated — showing the first ' + per.toLocaleString() + ' of ' + d.text.length.toLocaleString()
                + ' characters; raise "Document context" in Settings → Generation for more]' : '');
          }
        } else {
          const names = msg.docs.map(d => '"' + d.name + '"').join(', ');
          content += '\n\n[Documents ' + names + ' were attached earlier and are omitted here to save context — refer to the latest attachment.]';
        }
      }
      if ((msg.images || []).length) {
        const parts = [{ type: 'text', text: content }];
        for (const img of msg.images) parts.push({ type: 'image_url', image_url: { url: img } });
        out.push({ role: msg.role, content: parts });
      } else {
        out.push({ role: msg.role, content });
      }
    }
    return { messages: out, trimmed: start > 0, estPromptTokens: used };
  },

  // ---------- send / stop ----------
  async send() {
    if (this.generating) return;
    const input = el('chat-input');
    const text = input.value.trim();
    if (!text && !this.attachedImages.length && !this.attachedDocs.length) return;
    const c = this.conv();
    if (!c) return;
    if (!(await this.ensureEngine())) return;

    // keep the doc/code content ON the message - it is what the model will receive
    const userMsg = {
      role: 'user',
      content: text,
      images: this.attachedImages.map(a => a.dataUrl),
      docs: this.attachedDocs.map(d => ({ name: d.name, text: d.text }))
    };
    c.messages.push(userMsg);
    if (c.messages.length === 1) c.title = String(text || (userMsg.docs[0] && userMsg.docs[0].name) || (userMsg.images.length + ' image(s)')).slice(0, 36);
    input.value = '';
    input.style.height = 'auto';

    // render user msg
    const box = el('messages');
    if (c.messages.length === 1) box.innerHTML = '';
    this.renderMsg(userMsg);
    this.attachedImages = [];
    this.attachedDocs = [];
    this.renderAttachments();
    this.renderChatList();
    this.save();
    this.scrollDown(true);

    await this.runGeneration(c);
  },

  // stream one assistant answer for the conversation as it stands now
  async runGeneration(c) {
    const settings = await window.api.getSettings();
    const st = await window.api.llamaStatus();

    let built = this.buildApiMessages(c, { settings, ctx: st.ctx });
    if (built.trimmed) toast('Long conversation — older turns were trimmed automatically so it fits the model context.');

    this.setGenerating(true);
    const bub = this.renderMsg({ role: 'assistant', content: '' }, { streaming: true });
    bub.dataset.streaming = '1';
    bub.dataset.buf = '';
    bub.innerHTML = '<span class="cursor"></span>';
    this.streamingBubble = bub;
    this.scrollDown(true);

    const t0 = Date.now();
    let r = await window.api.chat(built.messages);

    // auto-retry: if the request still overflowed the context, squeeze and retry once
    if (!r.ok && /exceeds the available context|context size|too many tokens|prompt too long|maximum context/i.test(r.error || '')) {
      built = this.buildApiMessages(c, { settings, ctx: st.ctx, squeeze: 0.55 });
      toast('Context was too long — retrying with a shorter history (your newest messages and documents are kept).');
      r = await window.api.chat(built.messages);
    }

    // finalize
    this.setGenerating(false);
    bub.dataset.streaming = '0';

    if (r.ok) {
      const secs = Math.max(0.05, (Date.now() - t0) / 1000);
      const tok = estTokens(r.text || '');
      const meta = (tok >= 8 && !r.error) ? '⚡ ~' + Math.round(tok / secs) + ' tok/s · ' + (secs < 10 ? secs.toFixed(1) : Math.round(secs)) + 's' : null;
      c.messages.push({ role: 'assistant', content: r.text || '', stopped: !!r.stopped, finish: r.finish || null, stopNote: r.note || null, meta });
    } else {
      // keep the error visible in the UI but out of the model's history
      c.messages.push({ role: 'assistant', content: '⚠️ ' + (r.error || 'generation failed'), error: true });
    }
    this.renderChatList();
    this.save();
    this.renderMessages();   // cached redraw: only the new message gets highlighted
    this.scrollDown();
  },

  setGenerating(on) {
    this.generating = on;
    this.streamingBubble = on ? this.streamingBubble : null;
    el('btn-send').disabled = on;
    el('btn-send').style.display = on ? 'none' : '';
    el('btn-stop').hidden = !on;
    if (!on) {
      el('btn-stop').disabled = false;
      el('btn-stop').textContent = '⏹ Stop';
    }
  },

  // Continue: stream MORE text onto the last assistant answer (nothing restarts)
  async continueLast() {
    if (this.generating) return;
    const c = this.conv();
    if (!c) return;
    const last = c.messages[c.messages.length - 1];
    if (!last || last.role !== 'assistant' || last.error || !String(last.content || '').trim()) return;
    if (!(await this.ensureEngine())) return;

    // history up to and including the partial answer + a strict "keep going" instruction
    const hist = c.messages.slice(0, c.messages.indexOf(last) + 1).filter(m => !m.error);
    const settings = await window.api.getSettings();
    const st = await window.api.llamaStatus();
    const built = this.buildApiMessages({ messages: hist }, { settings, ctx: st.ctx });
    built.messages.push({
      role: 'user',
      content: 'Continue your previous answer EXACTLY from where it stopped. Do not repeat anything already written, do not start over, do not apologize or explain — output only the seamless continuation (keep the same formatting and language).'
    });

    // stream into the existing bubble
    const msgs = el('messages').children;
    let bub = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].classList.contains('ai')) { bub = msgs[i].querySelector('.bubble'); break; }
    }
    if (!bub) { this.renderMessages(); return this.continueLast(); }

    this.setGenerating(true);
    bub.dataset.streaming = '1';
    bub.dataset.buf = last.content || '';
    bub.innerHTML = mdToHtml(bub.dataset.buf, { live: true }) + '<span class="cursor"></span>';
    this.streamingBubble = bub;
    this.scrollDown(true);

    const r = await window.api.chat(built.messages, { maxTokens: settings.maxTokens });
    this.setGenerating(false);
    bub.dataset.streaming = '0';
    if (r.ok) {
      last.content = bub.dataset.buf;   // original text + streamed continuation
      last.stopped = !!r.stopped;
      last.finish = r.finish || null;
      last.stopNote = r.note || null;
      if (last.stopped) last.meta = null;
    } else {
      // generation failed: the original partial answer is untouched
      toast('Could not continue: ' + (r.error || 'generation failed'), 'err');
    }
    this.save();
    this.renderMessages();
    this.scrollDown();
  },

  // Regenerate: drop the last answer and produce a fresh one for the SAME question
  async regenerate() {
    if (this.generating) return;
    const c = this.conv();
    if (!c) return;
    const last = c.messages[c.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    c.messages.pop();               // remove old answer
    this.renderMessages();          // redraw (user question stays)
    this.save();
    await this.runGeneration(c);
  },

  async stop() {
    if (!this.generating) return;
    el('btn-stop').disabled = true;
    el('btn-stop').textContent = '⏹ Stopping…';
    const r = await window.api.chatStop();
    if (!r.ok) {
      // engine already finished (or died) - restore the button state
      el('btn-stop').disabled = false;
      el('btn-stop').textContent = '⏹ Stop';
      if (!this.generating) return;
    }
    // the pending chat() promise resolves right after the abort with the
    // partial text; safety net if it never comes:
    setTimeout(() => {
      if (this.generating) {
        el('btn-stop').disabled = false;
        el('btn-stop').textContent = '⏹ Stop';
      }
    }, 2500);
  }
};
window.Chat = Chat;
