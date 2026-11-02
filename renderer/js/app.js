// App shell: tabs, badges, settings, boot
const App = {
  async init() {
    // tab switching
    for (const btn of document.querySelectorAll('.nav-item')) {
      btn.onclick = () => {
        for (const b of document.querySelectorAll('.nav-item')) b.classList.remove('active');
        for (const t of document.querySelectorAll('.tab')) t.classList.remove('active');
        btn.classList.add('active');
        el('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'hardware') Hardware.detect();
        if (btn.dataset.tab === 'projects') Projects.refreshTree();
      };
    }
    // auto-grow textarea
    const ta = el('chat-input');
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
    });
    this.renderSettings();
    this.updateBadges();
    window.api.on('llama-status', () => this.updateBadges());
    window.api.on('sd-status', () => this.updateBadges());
    // the engine restarts a load with fewer GPU layers when Vulkan runs out of memory
    window.api.on('llama-retry', (d) => {
      toast('GPU memory ran out — retrying ' + (d.ngl === 0 ? 'on the CPU' : 'with ' + d.ngl + ' GPU layers') + '… (this is automatic)', '');
    });
  },

  async updateBadges() {
    const st = await window.api.llamaStatus();
    const b1 = el('badge-llm');
    b1.className = 'badge' + (st.running ? ' on' : '');
    b1.querySelector('.badge-txt').textContent = st.running
      ? 'LLM: ' + (st.model ? st.model.name : 'running') + (st.hasMmproj ? ' 👁' : '')
      : 'LLM off';
    const sst = await window.api.sdStatus();
    const b2 = el('badge-sd');
    b2.className = 'badge' + (sst.running ? ' on' : '');
    b2.querySelector('.badge-txt').textContent = sst.running
      ? 'Image: ' + (sst.model ? sst.model.name : 'running')
      : 'Image engine off';
  },

  async renderSettings() {
    const s = await window.api.getSettings();
    const box = el('settings-content');
    box.innerHTML = '';

    const gen = h('div', 'card');
    gen.appendChild(h('h3', '', 'Generation'));
    gen.appendChild(this.setRow('Temperature', 'temperature', s.temperature, 'number', 'step="0.1" min="0" max="2"'));
    gen.appendChild(this.setRow('Top P', 'topP', s.topP, 'number', 'step="0.05" min="0" max="1"'));
    gen.appendChild(this.setRow('Max new tokens', 'maxTokens', s.maxTokens, 'number', 'min="64" max="16384" step="64"', 'answer length budget — raise it so long code completes'));
    gen.appendChild(this.setRow('Document context (chars)', 'docContextChars', s.docContextChars ?? 12000, 'number', 'min="1000" max="200000" step="1000"', 'max characters of attached docs sent to the model'));
    const sp = h('div', 'set-row');
    sp.innerHTML = '<div><label>System prompt</label><div class="sub">Sent with every chat request</div></div>';
    const spv = document.createElement('textarea');
    spv.rows = 4; spv.value = s.systemPrompt || '';
    spv.style.width = '240px';
    sp.appendChild(spv);
    spv.onchange = () => window.api.setSettings({ systemPrompt: spv.value });
    gen.appendChild(sp);
    box.appendChild(gen);

    const eng = h('div', 'card');
    eng.appendChild(h('h3', '', 'Chat engine (llama.cpp)'));
    eng.appendChild(this.setRow('Context size', 'ctxSize', s.ctxSize, 'number', 'min="512" max="65536" step="512"', 'tokens of conversation memory'));
    eng.appendChild(this.setRow('CPU threads (0 = auto)', 'threads', s.threads, 'number', 'min="0" max="32"', 'auto = physical cores'));
    const gor = h('div', 'set-row');
    gor.innerHTML = '<div><label>GPU offload</label><div class="sub">Vulkan iGPU acceleration</div></div>';
    const gsel = document.createElement('select');
    for (const [v, t] of [['auto', 'Auto (iGPU if present)'], ['cpu', 'CPU only'], ['vulkan', 'Force Vulkan device']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t;
      if (s.gpuOffload === v) o.selected = true;
      gsel.appendChild(o);
    }
    gsel.onchange = async () => {
      await window.api.setSettings({ gpuOffload: gsel.value });
      const hw = await window.api.hw();
      this.renderVulkanList(hw);
    };
    gor.appendChild(gsel);
    eng.appendChild(gor);
    const vl = h('div', 'set-row');
    vl.innerHTML = '<div><label>Vulkan device</label><div class="sub">when “Force Vulkan”</div></div>';
    vl.id = 'vulkan-device-row';
    eng.appendChild(vl);
    eng.appendChild(this.setRow('Offload layers (99 = all)', 'offloadLayers', s.offloadLayers, 'number', 'min="0" max="99"', 'auto-falls back to fewer layers when GPU memory is full'));
    const tune = h('div', 'set-row');
    tune.innerHTML = '<div><label>GPU auto-tuning memory</label><div class="sub">remembers the layer count that fit for each model</div></div>';
    const tb = h('button', 'btn btn-sm', '↺ Reset');
    tb.title = 'Forget the remembered GPU layer counts — the next load tries full GPU offload again (use after freeing GPU memory)';
    tb.onclick = async () => {
      await window.api.setSettings({ nglMemo: {} });
      toast('GPU auto-tune reset — the next model load will try full GPU offload again', 'ok');
    };
    tune.appendChild(tb);
    eng.appendChild(tune);
    box.appendChild(eng);

    const sd = h('div', 'card');
    sd.appendChild(h('h3', '', 'Image engine (stable-diffusion.cpp)'));
    const sbr = h('div', 'set-row');
    sbr.innerHTML = '<div><label>Backend</label><div class="sub">Vulkan uses the iGPU</div></div>';
    const ssel = document.createElement('select');
    for (const [v, t] of [['auto', 'Auto (iGPU via Vulkan)'], ['cpu', 'CPU only']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t;
      if (s.sdBackend === v) o.selected = true;
      ssel.appendChild(o);
    }
    ssel.onchange = () => { window.api.setSettings({ sdBackend: ssel.value }); toast('Applies next time you load the image engine'); };
    sbr.appendChild(ssel);
    sd.appendChild(sbr);
    sd.appendChild(this.setRow('Threads (0 = auto)', 'sdThreads', s.sdThreads, 'number', 'min="0" max="32"'));
    box.appendChild(sd);

    const paths = h('div', 'card');
    paths.appendChild(h('h3', '', 'Storage'));
    const p = await window.api.paths();
    paths.appendChild(this.row('Models', p.models));
    paths.appendChild(this.row('Generated images', p.pictures));
    const ob = h('button', 'btn btn-block', '📂 Open pictures folder');
    ob.onclick = () => window.api.openFolder(p.pictures);
    paths.appendChild(ob);
    box.appendChild(paths);

    // vulkan device list (async fill)
    window.api.hw().then(hw => this.renderVulkanList(hw));
  },

  renderVulkanList(hw) {
    const row = el('vulkan-device-row');
    if (!row) return;
    const sel = row.querySelector('select');
    if (sel) sel.remove();
    const s = document.createElement('select');
    const auto = document.createElement('option');
    auto.value = ''; auto.textContent = 'auto';
    s.appendChild(auto);
    for (const d of (hw.vulkanDevices || [])) {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.id + ' — ' + d.name.slice(0, 22);
      s.appendChild(o);
    }
    s.onchange = () => window.api.setSettings({ vulkanDevice: s.value });
    row.appendChild(s);
  },

  setRow(label, key, value, type, extra, sub) {
    const r = h('div', 'set-row');
    const l = h('div', '', '<label>' + esc(label) + '</label>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : ''));
    r.appendChild(l);
    const inp = document.createElement('input');
    inp.type = type; inp.value = value;
    if (extra) for (const attr of extra.split(' ')) {
      const m = attr.match(/(\w+)="([^"]*)"/);
      if (m) inp.setAttribute(m[1], m[2]);
    }
    inp.onchange = () => {
      const v = type === 'number' ? (parseFloat(inp.value) || 0) : inp.value;
      const upd = {}; upd[key] = v;
      window.api.setSettings(upd);
      toast('Saved — applies to the next model load');
    };
    r.appendChild(inp);
    return r;
  },

  row(k, v) {
    const r = h('div', 'hw-row');
    r.appendChild(h('span', 'k', esc(k)));
    r.appendChild(h('span', 'v', esc(v)));
    return r;
  }
};

// boot
window.addEventListener('DOMContentLoaded', async () => {
  await App.init();
  await Chat.init();
  await Projects.init();
  await Studio.init();
  await Models.init();
  await Docs.init();
  await Hardware.init();
});
