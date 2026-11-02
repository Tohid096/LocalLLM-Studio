// Models tab: catalog cards, downloads with progress, local .gguf import with mmproj pairing
const Models = {
  progress: new Map(), // id -> pct

  async init() {
    el('btn-add-local').onclick = () => this.addLocal();
    window.api.on('dl-progress', (d) => {
      this.progress.set(d.id, d);
      this.updateCard(d.id);
    });
    this.render();
  },

  async render() {
    const list = await window.api.modelsList();
    const box = el('models-list');
    box.innerHTML = '';

    const cats = [
      { key: 'chat', title: '💬 Chat models' },
      { key: 'vision', title: '👁 Vision models (VLM — read images & screenshots)' },
      { key: 'image', title: '🎨 Image generation models' }
    ];
    for (const cat of cats) {
      box.appendChild(h('div', 'model-cat', cat.title));
      const grid = h('div', 'model-grid');
      for (const m of list[cat.key]) grid.appendChild(this.card(m));
      box.appendChild(grid);
    }

    if ((list.custom || []).length) {
      box.appendChild(h('div', 'model-cat', '📁 Your local models'));
      const grid = h('div', 'model-grid');
      for (const m of list.custom) grid.appendChild(this.customCard(m));
      box.appendChild(grid);
    }
  },

  card(m) {
    const c = h('div', 'model-card' + (m.installed ? ' installed' : ''));
    const head = h('div', 'model-head');
    head.appendChild(h('div', 'model-name', esc(m.name)));
    const tags = h('div', 'model-tags');
    if (m.recommended) tags.appendChild(h('span', 'chip star', '★ recommended'));
    if (m.quant) tags.appendChild(h('span', 'chip', esc(m.quant)));
    tags.appendChild(h('span', 'chip', fmtSize(m.size)));
    if (m.ctx) tags.appendChild(h('span', 'chip', (m.ctx / 1024) + 'K ctx'));
    if (m.category === 'vision') tags.appendChild(h('span', 'chip warn', 'vision · mmproj included'));
    if (m.installed) tags.appendChild(h('span', 'chip good', '✔ installed'));
    head.appendChild(tags);
    c.appendChild(head);
    c.appendChild(h('div', 'model-desc', esc(m.desc)));

    const foot = h('div', 'model-foot');
    const btn = h('button', 'btn ' + (m.installed ? '' : 'btn-primary'), m.installed ? '🗑 Remove' : '⬇ Download');
    btn.style.flex = '1';
    btn.onclick = () => m.installed ? this.remove(m) : this.download(m);
    foot.appendChild(btn);
    if (!m.installed) {
      const p = this.progress.get(m.id);
      const pct = p ? Math.floor(p.pct || 0) : 0;
      if (p && !p.done && !p.error && !p.canceled) {
        foot.appendChild(h('span', 'dl-state', pct + '%'));
      }
    } else {
      foot.appendChild(h('span', 'dl-state ok-green', '✔ ready'));
    }
    c.appendChild(foot);

    const pb = h('div', 'pbar');
    pb.style.display = 'none';
    pb.appendChild(h('div'));
    c.appendChild(pb);
    c.dataset.id = m.id;
    return c;
  },

  customCard(m) {
    const c = h('div', 'model-card installed');
    const head = h('div', 'model-head');
    head.appendChild(h('div', 'model-name', esc(m.name) + (m.category === 'vision' ? ' 👁' : '')));
    const tags = h('div', 'model-tags');
    tags.appendChild(h('span', 'chip', esc(m.arch || 'gguf')));
    if (m.sizeLabel) tags.appendChild(h('span', 'chip', esc(m.sizeLabel)));
    if (m.fsize) tags.appendChild(h('span', 'chip', fmtSize(m.fsize)));
    head.appendChild(tags);
    c.appendChild(head);
    c.appendChild(h('div', 'model-desc', (m.needsMmproj ? 'Vision model — needs its mmproj projector file. ' : 'Custom local model. ') +
      (m.mmprojFile ? 'mmproj: ' + esc(m.mmprojFile) : '')));

    const foot = h('div', 'model-foot');
    if (m.needsMmproj && !m.mmprojFile) {
      const mm = h('button', 'btn', '🔗 Pick mmproj');
      mm.style.flex = '1';
      mm.onclick = () => this.pickMmproj(m);
      foot.appendChild(mm);
    }
    const del = h('button', 'btn btn-danger', 'Remove');
    del.style.flex = '1';
    del.onclick = async () => { await window.api.deleteModel(m.id); window.dispatchEvent(new Event('models-changed')); this.render(); };
    foot.appendChild(del);
    c.appendChild(foot);
    return c;
  },

  async download(m) {
    toast('Downloading ' + m.name + ' (' + fmtSize(m.size) + ') — you can keep using the app');
    window.api.download(m.id); // async, progress via events
  },

  async remove(m) {
    await window.api.deleteModel(m.id);
    toast(m.name + ' removed');
    window.dispatchEvent(new Event('models-changed'));
    this.render();
  },

  updateCard(id) {
    const p = this.progress.get(id);
    if (!p) return;
    const card = document.querySelector('.model-card[data-id="' + id + '"]');
    if (!card) return;
    let pb = card.querySelector('.pbar');
    if (p.done) {
      pb.style.display = 'none';
      this.render();
      window.dispatchEvent(new Event('models-changed'));
      toast('Model installed ✔ (see Chat / Studio tabs)', 'ok');
      return;
    }
    if (p.error) { pb.style.display = 'none'; toast('Download failed: ' + p.error, 'err'); return; }
    if (p.canceled) { pb.style.display = 'none'; this.render(); return; }
    pb.style.display = 'block';
    pb.firstElementChild.style.width = Math.floor(p.pct || 0) + '%';
    const state = card.querySelector('.dl-state');
    if (state) state.textContent = Math.floor(p.pct || 0) + '% · ' + fmtSize(p.overallDone || 0) + ' / ' + fmtSize(p.overallTotal || 0);
  },

  async addLocal() {
    const file = await window.api.pickFile([{ name: 'GGUF models', extensions: ['gguf'] }]);
    if (!file) return;
    const r = await window.api.addLocal(file, null);
    if (!r.ok) {
      if (r.isMmproj) {
        toast(r.error, 'err');
        return;
      }
      toast('Could not add model: ' + r.error, 'err');
      return;
    }
    if (r.needsMmproj && !r.mmprojFound) {
      toast('Added, but this looks like a vision model with no mmproj next to it. Pick the mmproj file now.', 'err');
      const mm = await window.api.pickFile([{ name: 'GGUF projector', extensions: ['gguf'] }]);
      if (mm) {
        const r2 = await window.api.setMmproj(r.manifest.id, mm);
        if (r2.ok) toast('mmproj linked ✔ Vision ready', 'ok');
      }
    } else {
      toast(r.warning || ('Added ' + r.manifest.name + (r.mmprojFound ? ' + mmproj ✔ vision ready' : '')), 'ok');
    }
    window.dispatchEvent(new Event('models-changed'));
    this.render();
  },

  async pickMmproj(m) {
    const mm = await window.api.pickFile([{ name: 'GGUF projector', extensions: ['gguf'] }]);
    if (!mm) return;
    const r = await window.api.setMmproj(m.id, mm);
    if (r.ok) { toast('mmproj linked ✔ Vision ready', 'ok'); this.render(); window.dispatchEvent(new Event('models-changed')); }
    else toast('Failed: ' + r.error, 'err');
  }
};
window.Models = Models;
