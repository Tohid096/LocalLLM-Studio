// Hardware tab: CPU, iGPU (Vulkan), NPU status and acceleration guidance
const Hardware = {
  info: null,

  async init() {
    await this.detect();
  },

  async detect() {
    const box = el('hw-content');
    box.innerHTML = '<div class="hw-card"><h3>⏳ Detecting hardware…</h3></div>';
    this.info = await window.api.hw();
    const i = this.info;
    box.innerHTML = '';

    // CPU card
    const cpu = h('div', 'hw-card');
    cpu.appendChild(h('h3', '', '🧠 Processor'));
    cpu.appendChild(this.row('Model', i.cpu.name));
    cpu.appendChild(this.row('Architecture', i.arch.toUpperCase() + ' · ' + i.platform));
    cpu.appendChild(this.row('Cores', i.cpu.physical + ' physical / ' + i.cpu.logical + ' logical'));
    cpu.appendChild(this.row('Engine threads', i.cpu.threads + ' (auto-tuned, Zen AVX-512 kernels used when available)'));
    cpu.appendChild(h('div', 'hw-note', 'llama.cpp ships CPU kernels down to AVX-512 “Zen4/Zen5” variants — on Ryzen AI 300 series the fastest kernel is picked automatically.'));
    box.appendChild(cpu);

    // RAM
    const ram = h('div', 'hw-card');
    ram.appendChild(h('h3', '', '🧩 Memory'));
    ram.appendChild(this.row('Total', i.ram.totalGB + ' GB'));
    ram.appendChild(this.row('Free now', i.ram.freeGB + ' GB'));
    ram.appendChild(h('div', 'hw-note', 'Rule of thumb: a Q4 model uses ~0.6 GB per billion parameters, plus ~1 GB overhead. Close other big apps when loading 7B+ models.'));
    box.appendChild(ram);

    // iGPU / Vulkan
    const gpu = h('div', 'hw-card');
    gpu.appendChild(h('h3', '', '🎮 Graphics (iGPU) — Vulkan'));
    const hasVulkan = (i.vulkanDevices || []).length > 0;
    if (hasVulkan) {
      for (const d of i.vulkanDevices) gpu.appendChild(this.row(d.id, d.name, 'ok-green'));
      gpu.appendChild(h('div', 'hw-note ok-green', '✔ Vulkan devices found. Chat and image generation offload to the iGPU automatically (GPU usage will spike in Task Manager → Performance → GPU).'));
    } else {
      gpu.appendChild(this.row('Vulkan devices', 'none detected', 'ok-amber'));
      gpu.appendChild(h('div', 'hw-note', 'No Vulkan device was reported by the engine. If you have an AMD/Intel/NVIDIA GPU: update your graphics driver (Vulkan runtime ships with it), then restart the app. Everything still runs on CPU meanwhile.'));
    }
    box.appendChild(gpu);

    // NPU
    const npu = h('div', 'hw-card');
    npu.appendChild(h('h3', '', '🤖 NPU (XDNA)'));
    if (i.npu && i.npu.detected) {
      for (const n of i.npu.names) npu.appendChild(this.row('Device', n, 'ok-green'));
      npu.appendChild(h('div', 'hw-note', '✔ NPU detected by Windows. Heads-up, honest engineering: GGUF models (llama.cpp / stable-diffusion.cpp) cannot execute on NPUs — NPUs run ONNX graphs via the Ryzen AI SDK. This app therefore accelerates your iGPU via Vulkan, and uses your CPU\'s AVX-512 units. Your NPU stays available for other apps (e.g. Windows Studio Effects).'));
    } else {
      npu.appendChild(this.row('Status', 'not detected', 'ok-amber'));
      npu.appendChild(h('div', 'hw-note', 'If your CPU has an NPU (Ryzen AI 300 / Core Ultra), install “AMD Ryzen AI Driver” or Intel’s NPU driver from Windows Update / vendor site. Note: GGUF models cannot run on NPUs anyway — the iGPU (Vulkan) is the accelerator this app uses.'));
    }
    box.appendChild(npu);

    // engines card
    const eng = h('div', 'hw-card');
    eng.appendChild(h('h3', '', '⚙️ Engines'));
    eng.appendChild(this.row('llama.cpp', 'b12020 · Vulkan build · AVX-512 CPU kernels'));
    eng.appendChild(this.row('stable-diffusion.cpp', 'master-1030 · Vulkan build'));
    const st = await window.api.llamaStatus();
    eng.appendChild(this.row('Chat engine', st.running ? 'running (' + st.model.name + ')' : 'idle', st.running ? 'ok-green' : ''));
    const sst = await window.api.sdStatus();
    eng.appendChild(this.row('Image engine', sst.running ? 'running (' + sst.model.name + ')' : 'idle', sst.running ? 'ok-green' : ''));
    const btn = h('button', 'btn btn-block reinit', '🔄 Re-detect hardware');
    btn.onclick = () => this.detect();
    eng.appendChild(btn);
    box.appendChild(eng);
  },

  row(k, v, cls) {
    const r = h('div', 'hw-row');
    r.appendChild(h('span', 'k', esc(k)));
    r.appendChild(h('span', 'v ' + (cls || ''), esc(v)));
    return r;
  }
};
window.Hardware = Hardware;
