// Image Studio tab: model loading, generation with progress, gallery
const Studio = {
  models: [],
  current: null,
  generating: false,
  pollTimer: null,

  async init() {
    el('btn-sd-load').onclick = () => this.toggleEngine();
    el('btn-generate').onclick = () => this.generate();
    el('btn-open-gallery').onclick = async () => { const p = await window.api.paths(); window.api.openFolder(p.pictures); };
    el('sd-model-select').onchange = () => this.onModelChange();
    window.api.on('sd-status', () => this.renderEngineStatus());
    window.addEventListener('models-changed', () => this.refreshModels());
    this.refreshModels();
  },

  async refreshModels() {
    const list = await window.api.modelsList();
    this.models = list.image;
    const sel = el('sd-model-select');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const m of this.models) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name + (m.installed ? '' : ' (not downloaded)');
      sel.appendChild(o);
    }
    if (prev && this.models.some(m => m.id === prev)) sel.value = prev;
    this.onModelChange();
    this.renderEngineStatus();
  },

  onModelChange() {
    const m = this.models.find(x => x.id === el('sd-model-select').value);
    this.current = m;
    const hint = el('sd-model-hint');
    if (!m) { hint.textContent = ''; return; }
    hint.innerHTML = esc(m.desc) + '<br>' + (m.installed
      ? '✔ Installed · ' + fmtSize(m.size)
      : '⬇ Not downloaded yet — go to the <b>Models</b> tab to download it');
    if (m.installed && m.defaults) {
      el('sd-width').value = m.defaults.width;
      el('sd-height').value = m.defaults.height;
      el('sd-steps').value = m.defaults.steps;
      el('sd-cfg').value = m.defaults.cfg;
      el('sd-sampler').value = m.defaults.sampler;
      el('sd-negative').value = m.defaults.negative || '';
    }
  },

  async toggleEngine() {
    const st = await window.api.sdStatus();
    if (st.running) {
      await window.api.stopSD();
      toast('Image engine stopped');
      this.renderEngineStatus();
      return false;
    }
    const m = this.current;
    if (!m) { toast('Pick a model first'); return false; }
    if (!m.installed) {
      toast('Download “' + m.name + '” in the Models tab first', 'err');
      document.querySelector('[data-tab="models"]').click();
      return false;
    }
    el('btn-sd-load').disabled = true;
    el('sd-engine-status').className = 'engine-status';
    el('sd-engine-status').textContent = 'Loading ' + m.name + '… (big models take a minute)';
    const r = await window.api.startSD(m);
    el('btn-sd-load').disabled = false;
    if (r.ok) toast(m.name + ' loaded — Vulkan iGPU will be used automatically if available', 'ok');
    else toast('Engine failed: ' + r.error, 'err');
    this.renderEngineStatus();
    return r.ok;
  },

  async renderEngineStatus() {
    const st = await window.api.sdStatus();
    const box = el('sd-engine-status');
    const btn = el('btn-sd-load');
    if (st.running) {
      box.className = 'engine-status on';
      const settings = await window.api.getSettings();
      const backend = settings.sdBackend === 'cpu' ? 'CPU' : 'Vulkan iGPU (auto)';
      box.innerHTML = '<b>' + esc(st.model.name) + '</b> loaded · backend: ' + backend +
        '<br>Model stays warm in memory — generate as many images as you like.';
      btn.textContent = '⏹ Stop engine';
      btn.className = 'btn btn-block btn-danger';
    } else {
      box.className = 'engine-status';
      box.textContent = 'Engine is off. Load a model to start generating.';
      btn.textContent = '▶ Load engine';
      btn.className = 'btn btn-primary btn-block';
    }
    window.App.updateBadges();
  },

  async generate() {
    if (this.generating) return;
    const st = await window.api.sdStatus();
    if (!st.running) {
      const ok = await this.toggleEngine();
      if (!ok) return;
      await new Promise(r => setTimeout(r, 500));
    }
    const prompt = el('sd-prompt').value.trim();
    if (!prompt) return toast('Write a prompt first');

    const params = {
      prompt,
      negative: el('sd-negative').value,
      width: parseInt(el('sd-width').value) || 512,
      height: parseInt(el('sd-height').value) || 512,
      steps: parseInt(el('sd-steps').value) || 20,
      cfg: parseFloat(el('sd-cfg').value) || 7,
      sampler: el('sd-sampler').value,
      batch: parseInt(el('sd-batch').value) || 1,
      seed: parseInt(el('sd-seed').value),
      format: 'png'
    };

    this.generating = true;
    el('btn-generate').disabled = true;
    el('btn-generate').textContent = '⏳ Generating…';
    const prog = el('sd-progress');
    prog.innerHTML = 'Submitting job…';

    const r = await window.api.sdGen(params);
    if (!r.ok) {
      toast('Generation failed: ' + r.error, 'err');
      prog.textContent = '';
      this.resetGen();
      return;
    }
    this.pollJob(r.jobId, params);
  },

  resetGen() {
    this.generating = false;
    el('btn-generate').disabled = false;
    el('btn-generate').textContent = '✨ Generate';
  },

  async pollJob(jobId, params) {
    const prog = el('sd-progress');
    let ticks = 0;
    this.pollTimer = setInterval(async () => {
      ticks++;
      const r = await window.api.sdJob(jobId);
      if (!r.ok || !r.job) { clearInterval(this.pollTimer); this.resetGen(); prog.textContent = ''; return; }
      const j = r.job;
      if (j.status === 'queued') prog.innerHTML = 'Queued… (position ' + (j.queue_position || 0) + ')';
      else if (j.status === 'generating') prog.innerHTML = 'Painting… <div class="pbar"><div style="width:' + Math.min(95, ticks * 4) + '%"></div></div>';
      else if (j.status === 'failed') {
        clearInterval(this.pollTimer);
        this.resetGen();
        prog.textContent = '';
        toast('Generation failed: ' + (j.error_message || j.error_code || 'unknown'), 'err');
      } else if (j.status === 'cancelled') {
        clearInterval(this.pollTimer); this.resetGen(); prog.textContent = 'Cancelled.';
      } else if (j.status === 'completed') {
        clearInterval(this.pollTimer);
        prog.textContent = '';
        this.resetGen();
        this.showResults(j, params);
      }
      if (ticks > 1200) { clearInterval(this.pollTimer); this.resetGen(); }
    }, 1000);
  },

  async showResults(job, params) {
    const images = (job.result && job.result.images) || [];
    if (!images.length) return toast('No images returned', 'err');
    const gallery = el('gallery');
    if (gallery.querySelector('.empty')) gallery.innerHTML = '';
    const stamp = Date.now();
    for (let i = 0; i < images.length; i++) {
      const b64 = images[i].b64_json;
      const info = images[i].generation_info || {};
      const saved = await window.api.saveImage(b64, 'img-' + stamp + '-' + (i + 1) + '.png');
      const item = h('div', 'gallery-item');
      const im = document.createElement('img');
      im.src = 'data:image/' + (job.result.output_format || 'png') + ';base64,' + b64;
      im.onclick = () => this.lightbox(im.src);
      item.appendChild(im);
      const seed = info.sample_params && info.sample_params.seed !== undefined ? info.sample_params.seed : params.seed;
      const meta = h('div', 'meta',
        '<span>' + (params.width + '×' + params.height) + ' · ' + params.steps + ' steps · seed ' + seed + '</span>');
      const acts = h('div', 'acts');
      const save = h('button', '', '📂'); save.title = 'Show in folder';
      save.onclick = () => window.api.openPath(saved.path);
      const reuse = h('button', '', '🔁'); reuse.title = 'Reuse seed';
      reuse.onclick = () => { el('sd-seed').value = seed; toast('Seed copied to the seed field'); };
      acts.appendChild(save); acts.appendChild(reuse);
      meta.appendChild(acts);
      item.appendChild(meta);
      gallery.prepend(item);
    }
    toast('Saved ' + images.length + ' image' + (images.length > 1 ? 's' : '') + ' to Pictures → LocalLLM Studio', 'ok');
  },

  lightbox(src) {
    let lb = el('lightbox');
    if (!lb) {
      lb = h('div'); lb.id = 'lightbox';
      lb.onclick = () => lb.classList.remove('open');
      const im = document.createElement('img');
      lb.appendChild(im);
      document.body.appendChild(lb);
    }
    lb.querySelector('img').src = src;
    lb.classList.add('open');
  }
};
window.Studio = Studio;
