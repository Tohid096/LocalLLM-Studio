// Projects tab: multi-file workspace + local LLM agent
// v2.2.0:
//  - open any folder as a project (file tree, editor, create/rename/delete)
//  - add project files to the agent context (with a token budget)
//  - Agent mode: the model writes/edits real files via ```write:path``` blocks,
//    runs multi-step until DONE / step limit / Stop, auto-apply toggle
const Projects = {
  root: null,          // absolute project folder
  name: '',
  files: [],           // [{path, dir, size}]
  collapsed: new Set(),
  openFile: null,      // relative path of the file in the editor
  dirty: false,
  fileCache: new Map(),// rel -> content (context reads)
  ctx: new Set(),      // rel paths added to the agent context
  agent: {
    messages: [],      // [{role, content, actions:[{type,path,content,applied}], error}]
    running: false,
    aborted: false,
    autoApply: true,
    maxSteps: 8,
    step: 0
  },

  AGENT_SYSTEM: [
    'You are LocalLLM Agent, an autonomous coding agent that works directly inside the user\'s project folder.',
    'Follow these rules exactly:',
    '1. Think briefly about the task, then act. Be concise.',
    '2. To create a file or completely rewrite one, output a fenced code block whose info string is "write:" followed by the RELATIVE file path, for example:',
    '   ```write:src/app.js',
    '   ...entire file content...',
    '   ```',
    '3. To add content to the END of an existing file, use "append:" instead of "write:".',
    '4. One file per block. Always output the FULL content for write: blocks. Use forward slashes in paths.',
    '5. Never invent content for files you have not seen - ask the user to add them to the context instead.',
    '6. After the code blocks, write a short summary of what you did and what remains.',
    '7. When the whole task is finished, reply with exactly: DONE',
    'Do not wrap the whole answer in one code block. Plain markdown text + separate write:/append: blocks.'
  ].join('\n'),

  // ---------- lifecycle ----------
  async init() {
    el('btn-proj-open').onclick = () => this.openProject();
    el('btn-proj-refresh').onclick = () => this.refreshTree(true);
    el('btn-proj-newfile').onclick = () => this.beginCreate(false);
    el('btn-proj-newdir').onclick = () => this.beginCreate(true);
    el('btn-proj-save').onclick = () => this.saveOpenFile();
    el('btn-proj-reveal').onclick = () => { if (this.root) window.api.openFolder(this.root); };
    el('proj-editor').addEventListener('input', () => { this.dirty = true; this.renderEditorHead(); });
    el('proj-editor').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveOpenFile(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        this.dirty = true;
      }
    });
    // agent panel
    el('btn-agent-run').onclick = () => this.runAgent();
    el('btn-agent-stop').onclick = () => this.stopAgent();
    el('agent-auto').onchange = (e) => { this.agent.autoApply = e.target.checked; this.persistState(); };
    el('agent-task').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.runAgent(); }
    });
    el('btn-ctx-open-file').onclick = () => this.addCtx(this.openFile);
    el('btn-ctx-all').onclick = () => this.addAllTextFiles();
    el('btn-agent-clear').onclick = () => { this.agent.messages = []; this.renderAgent(); this.persistState(); };
    // delegated: tree rows + apply buttons
    el('proj-tree').addEventListener('click', (e) => this.onTreeClick(e));
    el('agent-log').addEventListener('click', (e) => {
      const btn = e.target.closest('.act-apply, .act-view');
      if (!btn) return;
      const card = btn.closest('.file-action');
      if (!card) return;
      const mi = +card.dataset.mi, ai = +card.dataset.ai;
      const act = this.agent.messages[mi] && this.agent.messages[mi].actions[ai];
      if (!act) return;
      if (btn.classList.contains('act-view')) {
        card.classList.toggle('open');
        return;
      }
      this.applyAction(act);
    });
    this.restoreState();
    this.renderAll();
  },

  renderAll() {
    this.renderProjectHead();
    this.renderTree();
    this.renderEditorHead();
    this.renderCtx();
    this.renderAgent();
  },

  // ---------- project ----------
  async openProject() {
    const dir = await window.api.pickFolder();
    if (!dir) return;
    this.root = dir;
    this.name = dir.split(/[\\/]/).pop() || dir;
    this.openFile = null;
    this.dirty = false;
    this.fileCache.clear();
    if (!this.ctx.size) { /* keep whatever was restored for this root */ }
    await this.refreshTree();
    this.renderAll();
    this.persistState();
    toast('Project opened: ' + this.name, 'ok');
  },

  async refreshTree(clearCache) {
    if (!this.root) return;
    if (clearCache) this.fileCache.clear();
    const r = await window.api.projectTree(this.root);
    if (r.ok) { this.files = r.files; this.name = r.name; }
    else toast('Could not read project: ' + r.error, 'err');
    this.renderTree();
    this.renderCtx();
  },

  renderProjectHead() {
    el('proj-title').textContent = this.root ? this.name : 'No project open';
    el('proj-sub').textContent = this.root ? this.root : 'Open a folder to work with its files';
    el('btn-proj-reveal').style.display = this.root ? '' : 'none';
  },

  // ---------- tree ----------
  visibleFiles() {
    const out = [];
    let hideUnder = null;
    for (const f of this.files) {
      if (hideUnder && f.path.startsWith(hideUnder)) continue;
      hideUnder = null;
      out.push(f);
      if (f.dir && this.collapsed.has(f.path)) hideUnder = f.path + '/';
    }
    return out;
  },

  renderTree() {
    const box = el('proj-tree');
    box.innerHTML = '';
    if (!this.root) {
      box.innerHTML = '<div class="hint" style="padding:14px 10px">No project yet.<br>Press “Open folder”.</div>';
      return;
    }
    const vis = this.visibleFiles();
    for (const f of vis) {
      const depth = f.path.split('/').length - 1;
      const row = h('div', 'tree-row' + (f.path === this.openFile ? ' active' : ''));
      row.style.paddingLeft = (8 + depth * 14) + 'px';
      row.dataset.path = f.path;
      row.dataset.dir = f.dir ? '1' : '0';
      const arrow = f.dir ? h('span', 'tree-arrow', this.collapsed.has(f.path) ? '▸' : '▾') : h('span', 'tree-arrow', '');
      row.appendChild(arrow);
      row.appendChild(h('span', 'tree-ico', f.dir ? (this.collapsed.has(f.path) ? '📁' : '📂') : this.fileIcon(f.path)));
      row.appendChild(h('span', 'tree-name', esc(f.path.split('/').pop())));
      const acts = h('span', 'tree-acts');
      if (!f.dir) {
        const add = h('button', 'tree-act', '＋');
        add.title = 'Add to agent context';
        add.dataset.act = 'ctx';
        acts.appendChild(add);
        if (f.path === this.openFile) row.classList.add('open');
      } else {
        const add = h('button', 'tree-act', '＋');
        add.title = 'Add this folder\'s files to the agent context';
        add.dataset.act = 'ctxdir';
        acts.appendChild(add);
      }
      const ren = h('button', 'tree-act', '✎');
      ren.title = 'Rename';
      ren.dataset.act = 'rename';
      acts.appendChild(ren);
      const del = h('button', 'tree-act danger', '🗑');
      del.title = 'Delete';
      del.dataset.act = 'delete';
      acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    }
    if (!vis.length) box.innerHTML = '<div class="hint" style="padding:14px 10px">Empty folder — create a file with “＋ File”.</div>';
  },

  fileIcon(p) {
    const e = p.split('.').pop().toLowerCase();
    const map = { js: '🟨', mjs: '🟨', cjs: '🟨', jsx: '🟨', ts: '🟦', tsx: '🟦', py: '🐍', html: '🌐', htm: '🌐', css: '🎨', scss: '🎨', json: '🧾', md: '📝', yml: '⚙️', yaml: '⚙️', toml: '⚙️', ini: '⚙️', env: '🔒', sql: '🗄️', sh: '🖥️', bat: '🖥️', ps1: '🖥️', c: '🔷', h: '🔷', cpp: '🔷', hpp: '🔷', cs: '🎯', java: '☕', kt: '☕', go: '🐹', rs: '🦀', rb: '💎', php: '🐘', vue: '💚', svelte: '🧡', dart: '🎯', txt: '📄', csv: '📊', ipynb: '📓' };
    return map[e] || '📄';
  },

  onTreeClick(e) {
    const btn = e.target.closest('.tree-act');
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const p = row.dataset.path;
    const isDir = row.dataset.dir === '1';
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'ctx') this.addCtx(p);
      else if (act === 'ctxdir') this.addCtxDir(p);
      else if (act === 'rename') this.beginRename(row, p, isDir);
      else if (act === 'delete') this.deletePath(p);
      return;
    }
    if (isDir) {
      if (this.collapsed.has(p)) this.collapsed.delete(p); else this.collapsed.add(p);
      this.renderTree();
    } else {
      this.openFileTab(p);
    }
  },

  async openFileTab(p) {
    if (this.dirty && !await this.confirmDiscard()) return;
    const r = await window.api.projectRead(this.root, p);
    if (!r.ok) { toast('Could not open ' + p + ': ' + r.error, 'err'); return; }
    this.openFile = p;
    this.dirty = false;
    el('proj-editor').value = r.content;
    el('proj-editor').readOnly = false;
    this.renderTree();
    this.renderEditorHead();
  },

  renderEditorHead() {
    el('editor-file').textContent = this.openFile || 'no file open';
    el('editor-dirty').textContent = this.dirty ? '● unsaved' : (this.openFile ? 'saved' : '');
    el('editor-dirty').className = 'editor-state ' + (this.dirty ? 'dirty' : 'ok');
    el('btn-proj-save').disabled = !this.openFile || !this.dirty;
    const none = !this.openFile;
    el('editor-empty').style.display = none ? '' : 'none';
    el('editor-wrap').style.display = none ? 'none' : '';
  },

  async saveOpenFile() {
    if (!this.openFile || !this.dirty) return;
    const r = await window.api.projectWrite(this.root, this.openFile, el('proj-editor').value);
    if (r.ok) {
      this.dirty = false;
      this.fileCache.delete(this.openFile);
      this.renderEditorHead();
      toast('Saved ' + this.openFile, 'ok');
      this.refreshTree();
    } else toast('Save failed: ' + r.error, 'err');
  },

  confirmDiscard() {
    if (!this.dirty) return Promise.resolve(true);
    return Promise.resolve(window.confirm('The open file has unsaved changes. Discard them?'));
  },

  // inline create form (Electron has no window.prompt)
  beginCreate(isDir) {
    if (!this.root) return toast('Open a project folder first');
    this.cancelInline();
    const form = h('div', 'tree-inline');
    const inp = document.createElement('input');
    inp.placeholder = isDir ? 'folder name' : 'file name (e.g. src/app.js)';
    const ok = h('button', 'btn btn-sm btn-primary', 'Create');
    const no = h('button', 'btn btn-sm', '✕');
    form.appendChild(inp); form.appendChild(ok); form.appendChild(no);
    el('proj-tree').prepend(form);
    inp.focus();
    const done = async () => {
      const v = inp.value.trim();
      if (!v) return this.cancelInline();
      const r = await window.api.projectCreate(this.root, v, isDir);
      if (!r.ok) { toast('Could not create: ' + r.error, 'err'); return; }
      this.cancelInline();
      await this.refreshTree();
      if (!isDir) this.openFileTab(v);
      toast((isDir ? 'Folder' : 'File') + ' created: ' + v, 'ok');
    };
    ok.onclick = done;
    no.onclick = () => this.cancelInline();
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') this.cancelInline(); };
    this._inline = form;
  },

  beginRename(row, p, isDir) {
    this.cancelInline();
    const name = p.split('/').pop();
    const form = h('div', 'tree-inline');
    const inp = document.createElement('input');
    inp.value = name;
    const ok = h('button', 'btn btn-sm btn-primary', 'Rename');
    const no = h('button', 'btn btn-sm', '✕');
    form.appendChild(inp); form.appendChild(ok); form.appendChild(no);
    row.replaceWith(form);
    inp.focus(); inp.select();
    const done = async () => {
      const v = inp.value.trim();
      const to = v && v !== name ? p.slice(0, p.length - name.length) + v : null;
      this.cancelInline();
      if (!to) return;
      const r = await window.api.projectRename(this.root, p, to);
      if (!r.ok) { toast('Rename failed: ' + r.error, 'err'); return; }
      if (this.openFile === p) this.openFile = to;
      if (this.ctx.has(p)) { this.ctx.delete(p); this.ctx.add(to); }
      await this.refreshTree();
      this.renderEditorHead();
      toast('Renamed to ' + to, 'ok');
    };
    ok.onclick = done;
    no.onclick = () => { this.cancelInline(); this.renderTree(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { this.cancelInline(); this.renderTree(); } };
    this._inline = form;
  },

  cancelInline() {
    if (this._inline && this._inline.remove) this._inline.remove();
    this._inline = null;
  },

  async deletePath(p) {
    if (!window.confirm('Delete "' + p + '"?' + (this.isDirPath(p) ? ' The whole folder and everything inside it will be removed.' : ''))) return;
    const r = await window.api.projectDelete(this.root, p);
    if (!r.ok) { toast('Delete failed: ' + r.error, 'err'); return; }
    if (this.openFile && (this.openFile === p || this.openFile.startsWith(p + '/'))) { this.openFile = null; this.dirty = false; el('proj-editor').value = ''; }
    this.ctx.delete(p);
    for (const k of [...this.ctx]) if (k.startsWith(p + '/')) this.ctx.delete(k);
    await this.refreshTree();
    this.renderEditorHead();
    toast('Deleted ' + p, 'ok');
  },
  isDirPath(p) { return this.files.some(f => f.dir && f.path === p); },

  // ---------- agent context ----------
  addCtx(p) {
    if (!p) return;
    const f = this.files.find(x => x.path === p);
    if (f && f.size > 512 * 1024) return toast(p + ' is > 512 KB — too big for the context. Add a smaller file.');
    if (!this.ctx.has(p)) { this.ctx.add(p); toast('Added to agent context: ' + p); }
    this.renderCtx();
    this.persistState();
  },
  addCtxDir(dirPrefix) {
    const add = this.files.filter(f => !f.dir && f.path.startsWith(dirPrefix + '/') && f.size <= 256 * 1024).slice(0, 40);
    if (!add.length) return toast('No files found in that folder');
    for (const f of add) this.ctx.add(f.path);
    this.renderCtx();
    this.persistState();
    toast(add.length + ' file(s) added to the agent context');
  },
  addAllTextFiles() {
    if (!this.root) return toast('Open a project folder first');
    const add = this.files.filter(f => !f.dir && f.size > 0 && f.size <= 128 * 1024 && !isBinaryName(f.path)).slice(0, 60);
    if (!add.length) return toast('No readable text files found');
    for (const f of add) this.ctx.add(f.path);
    this.renderCtx();
    this.persistState();
    toast(add.length + ' file(s) added to the agent context');
  },

  renderCtx() {
    const box = el('agent-ctx');
    box.innerHTML = '';
    let chars = 0;
    for (const p of this.ctx) {
      const f = this.files.find(x => x.path === p);
      chars += (f && f.size) || 0;
      const pill = h('div', 'ctx-pill');
      pill.appendChild(h('span', 'ctx-ico', this.fileIcon(p)));
      pill.appendChild(h('span', 'ctx-name', esc(p)));
      const x = h('span', 'x', '✕');
      x.onclick = () => { this.ctx.delete(p); this.renderCtx(); this.persistState(); };
      pill.appendChild(x);
      box.appendChild(pill);
    }
    el('agent-ctx-stats').textContent = this.ctx.size
      ? this.ctx.size + ' file(s) · ~' + fmtSize(chars) + ' · ~' + estTokens('x'.repeat(chars)).toLocaleString() + ' tokens (trimmed to fit the context automatically)'
      : 'No files in context — add files with ＋ in the tree, or “Add all files”.';
  },

  // pack context files into one text block, budgeted
  async packContext(budgetChars) {
    if (!this.ctx.size) return '';
    const parts = [];
    const per = Math.max(500, Math.floor(budgetChars / this.ctx.size));
    for (const p of [...this.ctx]) {
      let content = this.fileCache.get(p);
      if (content === undefined) {
        const r = await window.api.projectRead(this.root, p);
        content = r.ok ? r.content : null;
        this.fileCache.set(p, content);
      }
      if (content == null) { parts.push('--- ' + p + ' (could not be read) ---'); continue; }
      const t = content.length > per ? content.slice(0, per) + '\n… [truncated]' : content;
      parts.push('--- file: ' + p + ' ---\n' + t);
    }
    return parts.join('\n\n');
  },

  // ---------- agent ----------
  agentBusy(on) {
    this.agent.running = on;
    el('btn-agent-run').style.display = on ? 'none' : '';
    el('btn-agent-stop').hidden = !on;
    el('agent-task').disabled = on;
  },

  stopAgent() {
    if (!this.agent.running) return;
    this.agent.aborted = true;
    window.api.chatStop();
    toast('Stopping the agent — files already written stay written');
  },

  async runAgent() {
    if (this.agent.running) return;
    const input = el('agent-task');
    const task = input.value.trim();
    if (!task) return;
    if (!this.root) return toast('Open a project folder first');
    if (!(await Chat.ensureEngine())) return;

    input.value = '';
    this.agent.messages.push({ role: 'user', content: task });
    this.renderAgent();
    await this.agentLoop();
  },

  async agentLoop() {
    const settings = await window.api.getSettings();
    const st = await window.api.llamaStatus();
    const ctxTokens = Math.max(512, (st.ctx || settings.ctxSize || 8192) - (settings.maxTokens || 2048) - 700);
    const budgetChars = Math.min(parseInt(settings.docContextChars, 10) || 16000, Math.floor(ctxTokens * 3.6));

    this.agent.aborted = false;
    this.agent.step = 0;
    this.agentBusy(true);
    try {
      while (this.agent.step < this.agent.maxSteps) {
        if (this.agent.aborted) break;
        this.agent.step++;
        this.renderAgentStep();

        const ctxBlock = await this.packContext(budgetChars);
        // send the visible history, with the file context attached to the FIRST user turn
        const buildApi = (limit) => {
          const api = [{ role: 'system', content: this.AGENT_SYSTEM + '\nProject folder: ' + this.name }];
          const hist = this.agent.messages.slice(-30);
          const send = (limit && hist.length > limit) ? hist.slice(-limit) : hist;
          let first = true;
          for (const m of send) {
            if (m.error) continue;
            let content = m.content || '';
            if (first && m.role === 'user' && ctxBlock) {
              content = 'PROJECT FILES:\n' + ctxBlock + '\n\nTASK: ' + content;
              first = false;
            }
            api.push({ role: m.role, content });
          }
          return api;
        };
        let r = await window.api.chat(buildApi(0), { maxTokens: settings.maxTokens });
        if (!r.ok && /exceeds the available context|context size|too many tokens|prompt too long|maximum context/i.test(r.error || '')) {
          // history (or file context) too long: keep only the newest turns and retry
          r = await window.api.chat(buildApi(6), { maxTokens: settings.maxTokens });
        }

        if (this.agent.aborted && (!r.ok || !r.text)) {
          this.agent.messages.push({ role: 'assistant', content: '⏹ stopped by user', stopped: true });
          break;
        }
        if (!r.ok) {
          this.agent.messages.push({ role: 'assistant', content: '⚠️ ' + (r.error || 'generation failed'), error: true });
          break;
        }
        const actions = this.parseActions(r.text);
        this.agent.messages.push({ role: 'assistant', content: r.text, actions, stopped: !!r.stopped });
        this.renderAgent();

        const isDone = /(^|\n)\s*DONE\s*(\n|$)/.test(r.text);
        if (isDone || this.agent.aborted || !actions.length) break;

        // apply file actions
        let applied = 0, failed = 0;
        if (this.agent.autoApply) {
          for (const a of actions) {
            const okA = await this.applyAction(a);
            if (okA) applied++; else failed++;
          }
          this.renderAgent();
        }
        if (this.agent.aborted) break;
        const note = applied
          ? (this.agent.autoApply
            ? 'Applied your file changes (' + applied + ' file(s)' + (failed ? ', ' + failed + ' failed' : '') + '). Project files on disk are now updated. Continue with the next step if anything remains; reply DONE when finished.'
            : 'The user will apply your file changes manually. Continue with the next step if anything remains; reply DONE when finished.')
          : 'Continue with the task. Reply DONE when finished.';
        this.agent.messages.push({ role: 'user', content: note });
        this.renderAgent();
        if (this.agent.step >= this.agent.maxSteps) {
          this.agent.messages.push({ role: 'assistant', content: '⏹ step limit reached (' + this.agent.maxSteps + ') — run the agent again to continue.', error: false });
          this.renderAgent();
        }
      }
    } finally {
      this.agentBusy(false);
      this.renderAgent();
      this.persistState();
    }
  },

  parseActions(text) {
    const acts = [];
    const re = /```(write|append)\s*:\s*([^\n`]+)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
      acts.push({ type: m[1], path: m[2].trim(), content: m[3], applied: false, failed: false });
    }
    return acts;
  },

  async applyAction(a) {
    if (a.applied) return true;
    let ok;
    if (a.type === 'append') {
      const cur = await window.api.projectRead(this.root, a.path);
      ok = await window.api.projectWrite(this.root, a.path, (cur.ok ? cur.content : '') + a.content);
    } else {
      ok = await window.api.projectWrite(this.root, a.path, a.content);
    }
    a.applied = !!ok.ok;
    a.failed = !ok.ok;
    a.error = ok.error || null;
    if (ok.ok) {
      this.fileCache.delete(a.path);
      if (this.openFile === a.path) { // refresh the editor if this file is open
        const r2 = await window.api.projectRead(this.root, a.path);
        if (r2.ok) { el('proj-editor').value = r2.content; this.dirty = false; this.renderEditorHead(); }
      }
      this.refreshTree();
      toast((a.type === 'append' ? 'Appended to ' : 'Wrote ') + a.path, 'ok');
    } else {
      toast('Could not write ' + a.path + ': ' + ok.error, 'err');
    }
    this.persistState();
    return a.applied;
  },

  renderAgentStep() {
    let tag = el('agent-step');
    if (!tag) {
      tag = h('div', 'agent-step');
      el('agent-log').appendChild(tag);
    }
    tag.textContent = '⏳ agent step ' + this.agent.step + ' / ' + this.agent.maxSteps + ' …';
    el('agent-log').scrollTop = el('agent-log').scrollHeight;
  },

  renderAgent() {
    const log = el('agent-log');
    log.innerHTML = '';
    if (!this.agent.messages.length) {
      log.appendChild(h('div', 'hint', 'Give the agent a task — e.g.<br>“create a login page with validation, then a Node server for it”.<br>It reads the files in context, writes real files into the project and iterates until done.'));
    }
    for (let i = 0; i < this.agent.messages.length; i++) {
      const m = this.agent.messages[i];
      const div = h('div', 'msg ' + (m.role === 'user' ? 'user' : 'ai'));
      const av = h('div', 'avatar', m.role === 'user' ? '🧑' : '🤖');
      const bub = h('div', 'bubble');
      if (m.stopped) bub.appendChild(h('div', 'stopped-note', '⏹ stopped by user'));
      // split the text into plain-markdown segments and file-action cards
      let rest = String(m.content || '');
      if (m.actions && m.actions.length) {
        const re = /```(write|append)\s*:\s*([^\n`]+)\n([\s\S]*?)```/;
        let seg;
        let ai = 0;
        while ((seg = re.exec(rest)) !== null && ai < m.actions.length) {
          const before = rest.slice(0, seg.index);
          if (before.trim()) bub.appendChild(h('span', 'md', mdToHtml(before)));
          bub.appendChild(this.actionCard(m.actions[ai], i, ai));
          rest = rest.slice(seg.index + seg[0].length);
          ai++;
        }
      }
      if (rest.trim()) bub.appendChild(h('span', 'md', mdToHtml(rest)));
      if (!bub.children.length) bub.appendChild(h('span', 'md', mdToHtml(m.content || '')));
      div.appendChild(av); div.appendChild(bub);
      log.appendChild(div);
    }
    if (this.agent.running) this.renderAgentStep();
    log.scrollTop = log.scrollHeight;
  },

  actionCard(a, mi, ai) {
    const isNew = a.type === 'write' && !this.files.some(f => !f.dir && f.path === a.path);
    const card = h('div', 'file-action' + (a.applied ? ' applied' : '') + (a.failed ? ' failed' : ''));
    card.dataset.mi = mi; card.dataset.ai = ai;
    const head = h('div', 'fa-head');
    head.appendChild(h('span', 'fa-ico', a.type === 'append' ? '➕' : (isNew ? '✨' : '✏️')));
    head.appendChild(h('span', 'fa-path', esc(a.path)));
    head.appendChild(h('span', 'fa-kind', (isNew ? 'new file' : (a.type === 'append' ? 'append' : 'rewrite')) + ' · ' + fmtSize((a.content || '').length)));
    const btns = h('span', 'fa-btns');
    if (a.applied) {
      btns.appendChild(h('span', 'fa-ok', '✔ written to disk'));
    } else if (a.failed) {
      btns.appendChild(h('span', 'fa-err', '✖ ' + esc(a.error || 'failed')));
    } else {
      const ap = h('button', 'btn btn-sm btn-primary', 'Apply');
      ap.classList.add('act-apply');
      ap.title = 'Write this file into the project';
      btns.appendChild(ap);
    }
    const vw = h('button', 'btn btn-sm', 'View');
    vw.classList.add('act-view');
    btns.appendChild(vw);
    head.appendChild(btns);
    card.appendChild(head);
    const pre = h('pre', 'fa-code');
    pre.textContent = String(a.content || '').slice(0, 4000);
    card.appendChild(pre);
    return card;
  },

  // ---------- persistence ----------
  persistState() {
    try {
      localStorage.setItem('llm-project-state', JSON.stringify({
        root: this.root, openFile: this.openFile, ctx: [...this.ctx],
        autoApply: this.agent.autoApply, maxSteps: this.agent.maxSteps,
        collapsed: [...this.collapsed].slice(0, 200)
      }));
      const slim = this.agent.messages.slice(-40).map(m => ({
        role: m.role,
        content: String(m.content || '').slice(0, 6000),
        stopped: !!m.stopped, error: !!m.error,
        actions: (m.actions || []).map(a => ({ type: a.type, path: a.path, applied: !!a.applied, failed: !!a.failed, error: a.error, content: String(a.content || '').slice(0, 1500) }))
      }));
      localStorage.setItem('llm-project-agent', JSON.stringify({ root: this.root, messages: slim }));
    } catch (e) { /* quota */ }
  },

  restoreState() {
    try {
      const s = JSON.parse(localStorage.getItem('llm-project-state') || 'null');
      if (s && s.root) {
        this.root = s.root;
        this.name = s.root.split(/[\\/]/).pop() || s.root;
        this.ctx = new Set(s.ctx || []);
        this.collapsed = new Set(s.collapsed || []);
        this.agent.autoApply = s.autoApply !== false;
        this.agent.maxSteps = s.maxSteps || 8;
      }
      const a = JSON.parse(localStorage.getItem('llm-project-agent') || 'null');
      if (a && a.root === this.root && Array.isArray(a.messages)) this.agent.messages = a.messages;
    } catch (e) {}
    el('agent-auto').checked = this.agent.autoApply;
  }
};

function isBinaryName(p) {
  const e = (p.split('.').pop() || '').toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'rar', '7z', 'exe', 'dll',
    'so', 'dylib', 'bin', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'avi', 'mov', 'mkv', 'class',
    'o', 'a', 'lib', 'pyc', 'wasm', 'gguf', 'safetensors'].includes(e);
}

window.Projects = Projects;
