// LocalLLM Studio v2.2.1 - main process
// Engines: llama.cpp (Vulkan build) for LLM/VLM chat, stable-diffusion.cpp (Vulkan build) for image generation.
// v2.2.1: GPU out-of-memory auto-fallback (retries the load with fewer GPU layers, then CPU),
//         partial answers survive engine hiccups, higher default max tokens (4096).
// v2.2.0: chat-template-safe message normalization (no more "roles must alternate" errors),
//         vision-safe history (images degrade to notes without mmproj), finish_reason reporting,
//         Projects workspace IPC (multi-file agent work).

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const http = require('http');
const https = require('https');
const { CATALOG, VISION_ARCH_HINTS } = require('./catalog');
const { inspectGguf } = require('./gguf');

const isDev = !app.isPackaged;
const APP_ROOT = isDev ? __dirname : path.join(process.resourcesPath);
const ENGINES = {
  llama: path.join(APP_ROOT, 'engines', 'llama'),
  sd: path.join(APP_ROOT, 'engines', 'sd')
};
const LLAMA_SERVER = path.join(ENGINES.llama, 'llama-server.exe');
const SD_SERVER = path.join(ENGINES.sd, 'sd-server.exe');
const APP_ICON = isDev ? path.join(__dirname, 'build', 'icon.png') : path.join(process.resourcesPath, 'icon.png');

const USER_DATA = app.getPath('userData');
const MODELS_DIR = path.join(USER_DATA, 'models');
const PICTURES_DIR = path.join(app.getPath('pictures'), 'LocalLLM Studio');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');

let win = null;
let llamaProc = null;
let sdProc = null;
let downloadJobs = new Map(); // id -> { canceled, req }

const DEFAULT_SETTINGS = {
  threads: 0,            // 0 = auto (physical cores)
  ctxSize: 8192,
  gpuOffload: 'auto',    // auto | cpu | vulkan
  vulkanDevice: '',      // '' = auto, or 'Vulkan0' etc
  offloadLayers: 99,
  nglMemo: {},           // per-model "last ngl that fit in GPU memory" (auto-tuning memory)
  sdBackend: 'auto',     // auto (iGPU via Vulkan) | cpu
  sdThreads: 0,          // 0 = auto
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  docContextChars: 16000, // max characters of attached documents sent to the model
  systemPrompt: 'You are a helpful, friendly assistant running fully locally on the user\'s PC. Be concise and accurate.',
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch (e) { /* keep defaults */ }
  // v2.2.0 one-time upgrade: older installs kept the cramped old defaults
  // (only bumped when the user had not customized them away from the old values)
  if (!settings.v22) {
    const upd = {};
    if (settings.ctxSize === 4096) upd.ctxSize = 8192;
    if (settings.maxTokens === 1024) upd.maxTokens = 2048;
    if (settings.docContextChars === 12000) upd.docContextChars = 16000;
    upd.v22 = 1;
    settings = { ...settings, ...upd };
    saveSettings();
  }
  // v2.2.1: users on the 2048 default kept hitting the Max-new-tokens ceiling mid-code;
  // bump it once (only when untouched) so long answers complete without Continue.
  if (!settings.v23) {
    const upd = {};
    if (settings.maxTokens === 2048) upd.maxTokens = 4096;
    upd.v23 = 1;
    settings = { ...settings, ...upd };
    saveSettings();
  }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) {}
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function physicalCores() {
  const cpus = os.cpus().length || 8;
  return Math.max(1, Math.floor(cpus / 2));
}
function autoThreads() { return settings.threads > 0 ? settings.threads : physicalCores(); }

// ---------- utils ----------
function httpJson(port, method, p, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }); }
        catch (e) { resolve({ status: res.statusCode, json: null, text: data }); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const get = (port, p) => httpJson(port, 'GET', p, null);
const post = (port, p, obj) => httpJson(port, 'POST', p, JSON.stringify(obj));

function killTree(proc) {
  if (!proc) return;
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F']); } catch (e) { try { proc.kill('SIGKILL'); } catch (e2) {} }
}

// ---------- hardware detection ----------
async function detectHardware() {
  const cpus = os.cpus();
  const info = {
    cpu: { name: (cpus[0] || {}).model || 'Unknown CPU', logical: cpus.length, physical: physicalCores(), threads: autoThreads() },
    ram: { totalGB: +(os.totalmem() / 1e9).toFixed(1), freeGB: +(os.freemem() / 1e9).toFixed(1) },
    vulkanDevices: [], cpuBackends: [], npu: null, platform: os.platform(), arch: os.arch()
  };
  // enumerate ggml devices via llama-server --list-devices
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(LLAMA_SERVER, ['--list-devices'], { cwd: ENGINES.llama });
      let s = '';
      p.stdout.on('data', d => s += d);
      p.stderr.on('data', d => s += d);
      p.on('error', reject);
      p.on('close', () => resolve(s));
      setTimeout(() => { try { p.kill(); } catch (e) {} resolve(s); }, 15000);
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(Vulkan\d+|CUDA\d+|Metal\d+|SYCL\d+|RPC)\s*:\s*(.+)$/i);
      if (m) info.vulkanDevices.push({ id: m[1], name: m[2].trim() });
      const c = line.match(/^(CPU.*)$/i);
      if (c && line.includes('backend')) info.cpuBackends.push(c[1].trim());
      else if (c && !info.cpuBackends.length && line.toLowerCase().includes('cpu')) info.cpuBackends.push(c[1].trim());
    }
  } catch (e) { /* engines may be missing */ }
  // NPU detection (Windows)
  if (os.platform() === 'win32') {
    try {
      const ps = `Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'NPU|Neural|XDNA|AI Engine' -or $_.PNPClass -eq 'NETProcessingUnit' } | Select-Object -ExpandProperty Name`;
      const out = await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15000 }, (err, stdout) => err && !stdout ? reject(err) : resolve(String(stdout || '').trim()));
      });
      if (out) {
        info.npu = { detected: true, names: out.split(/\r?\n/).map(s => s.trim()).filter(Boolean) };
      } else {
        info.npu = { detected: false };
      }
    } catch (e) { info.npu = { detected: false }; }
  }
  return info;
}

// ---------- llama-server lifecycle ----------
function llamaStatus() {
  return {
    running: !!(llamaProc && !llamaProc.killed),
    pid: llamaProc ? llamaProc.pid : null,
    port: llamaProc ? llamaProc.port : null,
    model: llamaProc ? llamaProc.modelInfo : null,
    hasMmproj: llamaProc ? !!llamaProc.mmproj : false,
    ctx: llamaProc ? (llamaProc.ctxSize || null) : null,
    ngl: llamaProc ? (llamaProc.ngl ?? null) : null
  };
}

// Out-of-memory classifiers for llama-server load failures.
// A Vulkan iGPU exposes a *shared-memory* heap that is often far smaller than the
// installed RAM (BIOS/driver limit), so a 14B model on a "24 GB RAM" machine can
// still die with ErrorOutOfDeviceMemory. We detect that and retry with fewer
// offloaded layers instead of giving up.
const OOM_DEVICE_RE = /ErrorOutOfDeviceMemory|OUT_OF_DEVICE_MEMORY|out of device memory|VK_ERROR_OUT_OF_DEVICE_MEMORY|failed to allocate\s+(Vulkan|CUDA|Metal|SYCL|RPC)\S*\s*buffer|insufficient .*device memory/i;
const OOM_SYSTEM_RE = /bad_alloc|failed to allocate\s+\S*(CPU|cpu)\S*\s*buffer|out of memory|not enough memory|allocation failure|insufficient memory/i;

function isDeviceOOM(errText) { return OOM_DEVICE_RE.test(String(errText || '')); }
function isSystemOOM(errText) { return !isDeviceOOM(errText) && OOM_SYSTEM_RE.test(String(errText || '')); }

function firstErrorLines(errText, n = 3) {
  return (String(errText || '').split(/\r?\n/))
    .filter(l => /error|failed|cannot|abort|out of memory/i.test(l))
    .slice(0, n).map(l => l.trim()).filter(Boolean).join('\n');
}

// Descending ladder of -ngl values to try when the GPU runs out of memory.
function buildNglLadder(first) {
  const steps = [];
  const push = (n) => {
    n = Math.max(0, Math.min(99, Math.round(n)));
    if (!steps.includes(n)) steps.push(n);
  };
  push(first);
  for (const n of [40, 20, 8, 0]) if (n < first) push(n);
  if (!steps.includes(0)) steps.push(0);
  return steps;
}

// One spawn+health-poll attempt at a fixed -ngl. Resolves { ok, port, modalities }
// or { ok: false, error, errorRaw }.
function startLLMAttempt(opts, ngl) {
  const modelPath = opts.modelPath;
  const port = 18900 + Math.floor(Math.random() * 100);
  const args = [
    '--host', '127.0.0.1', '--port', String(port),
    '-m', modelPath,
    '-c', String(opts.ctxSize || settings.ctxSize),
    '-t', String(autoThreads()),
    '--flash-attn', 'auto'
  ];
  if (opts.mmprojPath && fs.existsSync(opts.mmprojPath)) { args.push('--mmproj', opts.mmprojPath); }
  // GPU offload
  const off = opts.gpuOffload || settings.gpuOffload;
  args.push('-ngl', String(ngl));
  if (off === 'vulkan' && settings.vulkanDevice) args.push('--device', settings.vulkanDevice);

  // big models on slow disks need minutes to mmap; scale the readiness window
  let fsize = 0;
  try { fsize = fs.statSync(modelPath).size; } catch (e) {}
  const maxTries = fsize > 4e9 ? 360 : 180;

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(LLAMA_SERVER, args, { cwd: ENGINES.llama, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: 'Failed to start engine: ' + e.message, errorRaw: e.message });
    }
    proc.port = port;
    proc.modelInfo = opts.modelInfo || { name: path.basename(modelPath) };
    proc.mmproj = opts.mmprojPath || null;
    proc.ctxSize = opts.ctxSize || settings.ctxSize || 8192;
    proc.ngl = ngl;
    llamaProc = proc;

    let started = false;
    let errText = '';
    const fail = (msg) => {
      if (started) return;
      started = true;
      killTree(proc);
      if (llamaProc === proc) llamaProc = null;
      resolve({ ok: false, error: msg, errorRaw: errText });
    };

    proc.stdout.on('data', d => {
      const s = String(d);
      send('llama-log', s);
      if (/error|failed|cannot|abort|out of memory/i.test(s)) errText += s;
    });
    proc.stderr.on('data', d => {
      const s = String(d);
      send('llama-log', s);
      if (/error|failed|cannot|abort|out of memory/i.test(s)) errText += s;
    });
    proc.on('error', e => fail('Engine failed to start: ' + e.message + ' (missing Vulkan runtime? update your GPU driver)'));
    proc.on('close', code => {
      if (llamaProc === proc) llamaProc = null;
      send('llama-status', llamaStatus());
      if (!started) {
        fail(firstErrorLines(errText) || ('Engine exited with code ' + code));
      }
    });

    // poll health
    let tries = 0;
    const poll = async () => {
      if (started) return;
      tries++;
      try {
        const r = await get(port, '/health');
        if (r.json && r.json.status === 'ok') {
          started = true;
          // read props for modalities
          let modalities = ['text'];
          try {
            const pr = await get(port, '/props');
            if (pr.json && pr.json.modalities) modalities = pr.json.modalities;
          } catch (e) {}
          send('llama-status', llamaStatus());
          resolve({ ok: true, port, modalities });
          return;
        }
      } catch (e) { /* not up yet */ }
      if (tries > maxTries) return fail('Engine did not become ready in time.' + (errText ? '\n' + errText.slice(0, 500) : ''));
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 500);
  });
}

async function startLLM(opts) {
  if (llamaProc) { abortActiveChat(); killTree(llamaProc); llamaProc = null; await new Promise(r => setTimeout(r, 800)); }
  const modelPath = opts.modelPath;
  if (!modelPath || !fs.existsSync(modelPath)) return { ok: false, error: 'Model file not found: ' + modelPath };

  const off = opts.gpuOffload || settings.gpuOffload;

  // pick the first -ngl to try
  let first;
  if (off === 'cpu') first = 0;
  else if (settings.offloadLayers > 0 && settings.offloadLayers < 99) first = settings.offloadLayers; // explicit user choice
  else {
    let memoKey = '';
    try { memoKey = modelPath.toLowerCase() + ':' + fs.statSync(modelPath).size; } catch (e) {}
    first = (memoKey && settings.nglMemo && settings.nglMemo[memoKey]) || 99;
  }

  const ladder = buildNglLadder(first);
  let lastErr = '';
  for (let i = 0; i < ladder.length; i++) {
    const ngl = ladder[i];
    if (i > 0) {
      // tell the UI why the load is restarting
      send('llama-retry', { attempt: i + 1, attempts: ladder.length, ngl });
      await new Promise(r => setTimeout(r, 700));
    }
    const r = await startLLMAttempt(opts, ngl);
    if (r.ok) {
      // remember the layer count that fit, so the next load of this model is instant
      if (off !== 'cpu') {
        try {
          const memoKey = modelPath.toLowerCase() + ':' + fs.statSync(modelPath).size;
          settings.nglMemo = settings.nglMemo || {};
          if (settings.nglMemo[memoKey] !== ngl) { settings.nglMemo[memoKey] = ngl; saveSettings(); }
        } catch (e) {}
      }
      return { ok: true, port: r.port, modalities: r.modalities, ngl, retried: i > 0 };
    }
    lastErr = r.error || '';
    if (isSystemOOM(r.errorRaw || lastErr)) {
      return {
        ok: false,
        error: 'Not enough system memory to load this model with the current settings.\n' + (firstErrorLines(r.errorRaw, 2) || lastErr) +
          '\n\nTips: close memory-heavy apps (browsers, games, VMs), lower "Context size" in Settings → Chat engine, or use a smaller model / lower quantization (Q4 instead of Q8).'
      };
    }
    if (!isDeviceOOM(r.errorRaw || lastErr)) return { ok: false, error: lastErr }; // unrelated failure: fail fast
    // device OOM → fall through and retry with fewer GPU layers
  }
  return {
    ok: false,
    error: 'Could not load this model: GPU memory ran out at every offload level and the CPU fallback failed too.\n' + (firstErrorLines(lastErr, 2) || lastErr) +
      '\n\nTry: Settings → Chat engine → GPU offload = CPU only, a smaller context size, or a smaller model file.'
  };
}

function stopLLM() {
  abortActiveChat();
  if (llamaProc) { killTree(llamaProc); llamaProc = null; }
  send('llama-status', llamaStatus());
  return { ok: true };
}

// ---------- chat message normalization ----------
// llama.cpp chat templates require strictly alternating user/assistant turns and a
// single leading system message. The UI history can violate that (e.g. an error
// answer was not stored, so two user turns end up back-to-back) which used to
// abort generation with a Jinja exception. This function makes ANY history safe:
//  - merges consecutive messages with the same role,
//  - keeps one system message at the front,
//  - degrades image parts to text notes when the loaded model has no mmproj,
//  - drops empty turns.
function normalizeMessages(messages) {
  const hasVision = !!(llamaProc && llamaProc.mmproj);
  const flat = [];
  for (const m of (messages || [])) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user');
    let content = '';
    const images = [];
    if (typeof m.content === 'string') content = m.content;
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p && p.type === 'text' && typeof p.text === 'string') content += p.text;
        else if (p && p.type === 'image_url' && p.image_url && p.image_url.url) images.push(p.image_url.url);
      }
    }
    if (!content.trim() && !images.length) continue;
    if (images.length && hasVision) {
      const parts = [{ type: 'text', text: content || '(image)' }];
      for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
      flat.push({ role, content: parts });
    } else {
      if (images.length) {
        content += (content ? '\n' : '') + '[' + images.length + ' image' + (images.length > 1 ? 's were' : ' was')
          + ' attached, but the currently loaded model has no vision projector (mmproj), so it cannot see '
          + (images.length > 1 ? 'them' : 'it')
          + '. Tell the user to switch to a 👁 vision model from the model list to analyze images.]';
      }
      flat.push({ role, content });
    }
  }
  // single leading system message
  let system = '';
  const out = [];
  for (const m of flat) {
    if (m.role === 'system') { system = system ? (system + '\n\n' + m.content) : m.content; continue; }
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string' && typeof m.content === 'string') {
      last.content += '\n\n' + m.content;   // merge consecutive same-role turns
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  if (system) out.unshift({ role: 'system', content: system });
  return out;
}

// ---------- chat streaming (abortable: Stop keeps the partial text) ----------
let activeChat = null; // { req, aborted, timedOut, full }

function abortActiveChat() {
  if (!activeChat) return;
  activeChat.aborted = true;
  try { if (activeChat.req) activeChat.req.destroy(); } catch (e) {}
}

function chatStop() {
  if (!activeChat) return { ok: false, error: 'Nothing is generating' };
  abortActiveChat();
  return { ok: true };
}

function chatStream(messages, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!llamaProc) return reject(new Error('No model is running'));
    const body = JSON.stringify({
      model: 'local',
      messages: normalizeMessages(messages),
      temperature: opts.temperature ?? settings.temperature,
      top_p: opts.topP ?? settings.topP,
      max_tokens: opts.maxTokens ?? settings.maxTokens,
      stream: true
    });
    let full = '';
    let settled = false;
    const state = { req: null, aborted: false, timedOut: false, connLost: false, full: '', finish: null };
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (activeChat === state) activeChat = null;
      fn(arg);
    };
    // aborted/interrupted with partial text -> resolve so the UI keeps what was generated
    const abortResult = (e) => {
      if (state.timedOut && !full) return done(reject, new Error('Generation timed out'));
      done(resolve, {
        text: full,
        stopped: true,
        finish: state.finish,
        note: state.timedOut
          ? '⏳ generation timed out — partial reply kept, press ▶ Continue to finish it'
          : (state.connLost
            ? '⚠️ the connection to the engine was lost — partial reply kept, press ▶ Continue to finish it'
            : null)
      });
    };

    const req = http.request({
      host: '127.0.0.1', port: llamaProc.port, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      if (res.statusCode !== 200) {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => done(reject, new Error(extractApiError(d))));
        return;
      }
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const choice = j.choices && j.choices[0];
            const delta = choice && choice.delta;
            if (choice && choice.finish_reason) state.finish = choice.finish_reason;
            if (delta && delta.content) {
              full += delta.content;
              state.full = full;
              send('chat-token', { text: delta.content });
            }
          } catch (e) {}
        }
      });
      res.on('end', () => done(resolve, { text: full, finish: state.finish }));
      res.on('close', () => { if (!settled && (state.aborted || full)) abortResult(); });
      res.on('error', (e) => {
        if (state.aborted) return abortResult(e);
        if (full) { state.connLost = true; return abortResult(e); }   // engine died mid-answer: keep the partial text
        done(reject, e);
      });
    });
    state.req = req;
    activeChat = state;
    req.setTimeout(600000, () => { state.timedOut = true; state.aborted = true; try { req.destroy(); } catch (e) {} });
    req.on('error', (e) => { if (state.aborted) abortResult(e); else done(reject, e); });
    req.write(body);
    req.end();
  });
}

function extractApiError(d) {
  try {
    const j = JSON.parse(d);
    const msg = j.error && (j.error.message || j.error) || j.message || d;
    if (/image input is not supported/.test(String(msg))) {
      return 'This model cannot see images yet. It needs its vision projector (mmproj) file. Open the Models tab and load a vision model with its mmproj, or pick an mmproj file for this model.';
    }
    const m = String(msg);
    if (/ECONNRESET|ECONNREFUSED|socket hang up|write EPIPE/i.test(m)) {
      return 'The model engine stopped unexpectedly (it may have run out of memory). Unload and reload the model, then press ▶ Continue to finish the answer. If it keeps happening, use a smaller model, a smaller context size, or Settings → Chat engine → GPU offload = CPU only.';
    }
    if (/exceeds the available context|context size|context window|prompt too long|too many tokens|maximum context|exceeds?.*(context|tokens)/i.test(m)) {
      return m.slice(0, 400) + '\n\nTip: the conversation plus attached documents is longer than the model\'s context. Lower "Document context" in Settings → Generation, start a new chat, or raise Context size and reload the model.';
    }
    return m.slice(0, 800);
  } catch (e) { return String(d).slice(0, 800) || 'Unknown engine error'; }
}

// ---------- sd-server lifecycle ----------
function sdStatus() {
  return {
    running: !!(sdProc && !sdProc.killed),
    port: sdProc ? sdProc.port : null,
    model: sdProc ? sdProc.modelInfo : null
  };
}

function sdArgsForModel(entry) {
  const baseDir = path.join(MODELS_DIR, entry.id);
  switch (entry.kind) {
    case 'sd1-dir': return ['-m', path.join(baseDir, 'ds8')];
    case 'sd-file': return ['-m', path.join(baseDir, entry.files[0].path)];
    case 'flux':
      return [
        '--diffusion-model', path.join(baseDir, 'flux', 'flux1-schnell-Q4_K_S.gguf'),
        '--clip_l', path.join(baseDir, 'flux', 'clip_l.safetensors'),
        '--t5xxl', path.join(baseDir, 'flux', 't5-v1_1-xxl-encoder-Q3_K_M.gguf'),
        '--vae', path.join(baseDir, 'flux', 'ae.safetensors')
      ];
    default: return [];
  }
}

async function startSD(entry) {
  if (sdProc) { killTree(sdProc); sdProc = null; await new Promise(r => setTimeout(r, 800)); }
  const args = ['--listen-ip', '127.0.0.1', '--listen-port', '0'];
  // pick a free port ourselves: start with a random and let sd-server report
  const port = 19100 + Math.floor(Math.random() * 100);
  args[3] = String(port);
  args.push(...sdArgsForModel(entry));
  const threads = settings.sdThreads > 0 ? settings.sdThreads : physicalCores();
  args.push('-t', String(threads));
  if (settings.sdBackend === 'cpu') args.push('--backend', 'cpu');

  return await new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(SD_SERVER, args, { cwd: ENGINES.sd, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: 'Failed to start image engine: ' + e.message });
    }
    proc.port = port;
    proc.modelInfo = { id: entry.id, name: entry.name, defaults: entry.defaults || {}, recipe: entry.recipe };
    sdProc = proc;

    let started = false;
    let errText = '';
    const fail = (msg) => {
      if (started) return;
      started = true;
      killTree(proc);
      if (sdProc === proc) sdProc = null;
      resolve({ ok: false, error: msg });
    };
    proc.stdout.on('data', d => { const s = String(d); send('sd-log', s); if (/error|failed/i.test(s)) errText += s; });
    proc.stderr.on('data', d => { const s = String(d); send('sd-log', s); if (/error|failed/i.test(s)) errText += s; });
    proc.on('error', e => fail('Image engine failed to start: ' + e.message + ' (missing Vulkan runtime? update your GPU driver)'));
    proc.on('close', code => {
      if (sdProc === proc) sdProc = null;
      send('sd-status', sdStatus());
      if (!started) fail((errText || '').slice(0, 600) || ('Image engine exited with code ' + code));
    });

    let tries = 0;
    const poll = async () => {
      if (started) return;
      tries++;
      try {
        const r = await get(port, '/sdcpp/v1/models/status');
        if (r.json && r.json.state === 'ready') {
          started = true;
          send('sd-status', sdStatus());
          resolve({ ok: true, port });
          return;
        }
        if (r.json && r.json.state === 'failed') {
          return fail('Model failed to load: ' + JSON.stringify(r.json.error || '').slice(0, 400));
        }
      } catch (e) {}
      if (tries > 300) return fail('Image engine did not become ready in time.' + (errText ? '\n' + errText.slice(0, 400) : ''));
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 700);
  });
}

function stopSD() {
  if (sdProc) { killTree(sdProc); sdProc = null; }
  send('sd-status', sdStatus());
  return { ok: true };
}

// ---------- downloads ----------
function downloadFile(url, dest, onProgress, jobId) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let start = 0;
    try { if (fs.existsSync(dest + '.part')) start = fs.statSync(dest + '.part').size; } catch (e) {}
    const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
    const req = https.get(url, { headers, followRedirects: true }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(new URL(res.headers.location, url).href, dest, onProgress, jobId).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let total = parseInt(res.headers['content-length'] || '0', 10);
      if (res.statusCode === 206) total += start;
      const stream = fs.createWriteStream(dest + '.part', { flags: start > 0 ? 'a' : 'w' });
      let done = start;
      res.on('data', c => {
        done += c.length;
        stream.write(c);
        if (onProgress) onProgress(done, total);
      });
      res.on('end', () => {
        stream.end(() => {
          try { fs.renameSync(dest + '.part', dest); resolve(fs.statSync(dest).size); }
          catch (e) { reject(e); }
        });
      });
      res.on('error', e => { stream.end(); reject(e); });
      if (jobId) {
        const job = downloadJobs.get(jobId);
        if (job) job.req = req;
      }
    });
    req.on('error', reject);
    if (jobId) {
      const job = downloadJobs.get(jobId);
      if (job) job.req = req;
    }
  });
}

async function downloadModel(id) {
  const all = [...CATALOG.chat, ...CATALOG.vision, ...CATALOG.image];
  const entry = all.find(m => m.id === id);
  if (!entry) return { ok: false, error: 'Unknown model: ' + id };
  const job = { canceled: false };
  downloadJobs.set(id, job);
  const dir = path.join(MODELS_DIR, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let doneBytes = 0;
    for (const f of entry.files) {
      if (job.canceled) throw new Error('canceled');
      const dest = path.join(dir, f.path);
      if (f.inline === 'json') {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(CATALOG.DREAMSHAPER_INDEX, null, 2));
        continue;
      }
      // dest only exists after a fully completed download (.part is renamed on success)
      if (fs.existsSync(dest)) continue;
      await downloadFile(f.url, dest, (done, total) => {
        send('dl-progress', {
          id, file: f.path,
          fileDone: done, fileTotal: total,
          overallDone: doneBytes + done, overallTotal: entry.size,
          pct: entry.size ? Math.min(100, ((doneBytes + done) / entry.size) * 100) : 0
        });
      }, id);
      doneBytes += fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    }
    // manifest
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, name: entry.name, category: entry.category, downloadedAt: Date.now() }, null, 2));
    send('dl-progress', { id, pct: 100, done: true });
    downloadJobs.delete(id);
    return { ok: true };
  } catch (e) {
    downloadJobs.delete(id);
    if (String(e.message) === 'canceled') { send('dl-progress', { id, pct: 0, canceled: true }); return { ok: false, canceled: true }; }
    send('dl-progress', { id, pct: 0, error: e.message });
    return { ok: false, error: e.message };
  }
}

function cancelDownload(id) {
  const job = downloadJobs.get(id);
  if (job) {
    job.canceled = true;
    try { if (job.req) job.req.destroy(); } catch (e) {}
  }
  return { ok: true };
}

// ---------- installed models ----------
function listInstalled() {
  const installed = { chat: [], vision: [], image: [] };
  if (!fs.existsSync(MODELS_DIR)) return installed;
  for (const cat of ['chat', 'vision', 'image']) {
    for (const entry of CATALOG[cat]) {
      const dir = path.join(MODELS_DIR, entry.id);
      let complete = fs.existsSync(path.join(dir, 'manifest.json'));
      const local = {
        ...entry,
        installed: complete,
        installing: false,
        modelPath: null, mmprojPath: null
      };
      if (complete) {
        if (entry.category === 'chat') local.modelPath = path.join(dir, entry.files[0].path);
        if (entry.category === 'vision') {
          for (const f of entry.files) {
            if (f.mmproj) local.mmprojPath = path.join(dir, f.path);
            else local.modelPath = path.join(dir, f.path);
          }
        }
      }
      installed[cat].push(local);
    }
  }
  // custom user-added models
  const customDir = path.join(MODELS_DIR, 'custom');
  installed.custom = [];
  if (fs.existsSync(customDir)) {
    for (const name of fs.readdirSync(customDir)) {
      const mf = path.join(customDir, name, 'manifest.json');
      if (fs.existsSync(mf)) {
        try {
          const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
          // models stay where the user keeps them; fall back to copied location
          m.modelPath = (m.sourcePath && fs.existsSync(m.sourcePath)) ? m.sourcePath : path.join(customDir, name, m.file);
          if (m.mmprojSourcePath && fs.existsSync(m.mmprojSourcePath)) m.mmprojPath = m.mmprojSourcePath;
          else if (m.mmprojFile) {
            const cand = path.join(path.dirname(m.modelPath), m.mmprojFile);
            m.mmprojPath = fs.existsSync(cand) ? cand : null;
          } else if (m.needsMmproj) m.mmprojPath = null;
          m.installed = true;
          installed.custom.push(m);
        } catch (e) {}
      }
    }
  }
  return installed;
}

function deleteModel(id) {
  const dir = path.join(MODELS_DIR, id);
  try { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// add a local model: inspect gguf, optionally pair mmproj from same folder
async function addLocalModel(modelPath, mmprojPath) {
  try {
    if (!fs.existsSync(modelPath)) return { ok: false, error: 'File not found' };
    const info = inspectGguf(modelPath);
    if (!info.valid) return { ok: false, error: info.error };

    // if the user picked an mmproj by mistake, tell them
    if (info.isMmproj && !mmprojPath) {
      return {
        ok: false, isMmproj: true,
        error: 'This file is a vision projector (mmproj), not a full model. Pick the main model .gguf and use this file as its mmproj.'
      };
    }
    const archLower = info.arch.toLowerCase();
    const needsMmproj = VISION_ARCH_HINTS.some(h => archLower.includes(h)) || /vl|vision|llava|moondream/i.test(archLower + ' ' + (info.name || ''));

    // scan folder for mmproj
    let foundMmproj = mmprojPath || null;
    if (!foundMmproj && needsMmproj) {
      const dir = path.dirname(modelPath);
      for (const f of fs.readdirSync(dir)) {
        if (/^mmproj/i.test(f) && f.endsWith('.gguf')) { foundMmproj = path.join(dir, f); break; }
      }
    }

    const id = 'user-' + path.basename(modelPath).replace(/\.gguf$/i, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60).toLowerCase();
    const dir = path.join(MODELS_DIR, 'custom', id);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = {
      id,
      name: info.name || path.basename(modelPath),
      category: needsMmproj ? 'vision' : 'chat',
      custom: true,
      arch: info.arch,
      sizeLabel: info.sizeLabel || '',
      quant: String(info.metadata['general.file_type'] || ''),
      fsize: info.fsize,
      needsMmproj,
      file: path.basename(modelPath),
      sourcePath: modelPath,
      mmprojFile: foundMmproj ? path.basename(foundMmproj) : null,
      downloadedAt: Date.now()
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return {
      ok: true, manifest, needsMmproj, mmprojFound: !!foundMmproj,
      mmprojName: foundMmproj ? path.basename(foundMmproj) : null,
      warning: needsMmproj && !foundMmproj
        ? 'This looks like a vision model but no mmproj projector file was found next to it. Chat will work, but image input needs the mmproj - pick it in the Models tab.'
        : null
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function setCustomMmproj(id, mmprojPath) {
  const mf = path.join(MODELS_DIR, 'custom', id, 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.mmprojFile = path.basename(mmprojPath);
    m.mmprojSourcePath = mmprojPath;
    m.needsMmproj = true;
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------- generation ----------
async function sdGenerate(params) {
  if (!sdProc) throw new Error('Image engine not running');
  const body = {
    prompt: params.prompt || '',
    negative_prompt: params.negative || '',
    width: params.width || 512,
    height: params.height || 512,
    seed: params.seed === undefined || params.seed === null ? -1 : params.seed,
    batch_count: params.batch || 1,
    clip_skip: -1,
    strength: 0.75,
    output_format: params.format || 'png',
    output_compression: 100,
    preview: 'none',
    preview_interval: 1,
    cache_mode: 'disabled',
    sample_params: {
      scheduler: params.scheduler || 'default',
      sample_method: params.sampler || 'euler_a',
      sample_steps: params.steps || 20,
      eta: '',
      shifted_timestep: 0,
      flow_shift: '',
      guidance: {
        txt_cfg: params.cfg || 7,
        img_cfg: '',
        distilled_guidance: params.distilledGuidance || 3.5,
        slg_layers: '7,8,9',
        layer_start: 0.01,
        layer_end: 0.2,
        scale: 0
      }
    }
  };
  const r = await post(sdProc.port, '/sdcpp/v1/img_gen', body);
  if (r.status !== 202 || !r.json || !r.json.id) throw new Error('Generation request failed: ' + JSON.stringify(r.json || r.text).slice(0, 300));
  return { jobId: r.json.id };
}

function saveImage(b64, suggestedName) {
  fs.mkdirSync(PICTURES_DIR, { recursive: true });
  const name = suggestedName || ('image-' + Date.now() + '.png');
  const p = path.join(PICTURES_DIR, name);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return { path: p, folder: PICTURES_DIR };
}

// ---------- projects (multi-file workspace for the agent) ----------
const PROJECT_IGNORE = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'target',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'env', '.idea', '.vs', '.vscode',
  'vendor', 'bin', 'obj', 'coverage', '.cache', '.gradle', 'build']);
const MAX_PROJECT_FILES = 4000;
const MAX_READ_BYTES = 2 * 1024 * 1024;

// resolve a relative path inside the project root, or null when it escapes the root
function projectPath(root, rel) {
  if (!root || typeof rel !== 'string') return null;
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  if (abs === r || abs.startsWith(r + path.sep)) return abs;
  return null;
}

function projectTree(root) {
  const files = [];
  const walk = (dir, rel, depth) => {
    if (files.length >= MAX_PROJECT_FILES || depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
    for (const ent of entries) {
      if (files.length >= MAX_PROJECT_FILES) return;
      const isDot = ent.name.startsWith('.');
      if (ent.isDirectory()) {
        if (isDot || PROJECT_IGNORE.has(ent.name)) continue;
        const rel2 = rel ? rel + '/' + ent.name : ent.name;
        files.push({ path: rel2, dir: true });
        walk(path.join(dir, ent.name), rel2, depth + 1);
      } else {
        let size = 0;
        try { size = fs.statSync(path.join(dir, ent.name)).size; } catch (e) {}
        files.push({ path: rel ? rel + '/' + ent.name : ent.name, size });
      }
    }
  };
  walk(root, '', 0);
  return files;
}

function projectRead(root, rel) {
  const abs = projectPath(root, rel);
  if (!abs) return { ok: false, error: 'Path escapes the project folder' };
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) return { ok: false, error: 'Is a directory' };
    if (st.size > MAX_READ_BYTES) return { ok: false, error: 'File is larger than 2 MB', size: st.size };
    const buf = fs.readFileSync(abs);
    // binary sniff: NUL byte or too many control chars in the first 8 KB
    const probe = buf.slice(0, 8192);
    let bad = 0;
    for (let i = 0; i < probe.length; i++) {
      const c = probe[i];
      if (c === 0) return { ok: false, error: 'Binary file', size: st.size };
      if (c < 9 || (c > 13 && c < 32)) bad++;
    }
    if (probe.length && bad / probe.length > 0.02) return { ok: false, error: 'Binary file', size: st.size };
    return { ok: true, content: buf.toString('utf8'), size: st.size };
  } catch (e) { return { ok: false, error: e.message }; }
}

function projectWrite(root, rel, content) {
  const abs = projectPath(root, rel);
  if (!abs || !rel || rel === '.') return { ok: false, error: 'Invalid path' };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content == null ? '' : content), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function projectCreate(root, rel, isDir) {
  const abs = projectPath(root, rel);
  if (!abs || !rel) return { ok: false, error: 'Invalid path' };
  try {
    if (fs.existsSync(abs)) return { ok: false, error: 'Already exists' };
    if (isDir) fs.mkdirSync(abs, { recursive: true });
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, '', 'utf8'); }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function projectDelete(root, rel) {
  const abs = projectPath(root, rel);
  if (!abs || !rel || abs === path.resolve(root)) return { ok: false, error: 'Invalid path' };
  try { fs.rmSync(abs, { recursive: true, force: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function projectRename(root, rel, to) {
  const abs = projectPath(root, rel);
  const dest = projectPath(root, to);
  if (!abs || !dest || !rel || !to) return { ok: false, error: 'Invalid path' };
  try {
    if (fs.existsSync(dest)) return { ok: false, error: 'Target already exists' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(abs, dest);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}


function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// single instance: focus existing window instead of spawning engines twice
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  loadSettings();
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.mkdirSync(PICTURES_DIR, { recursive: true });
  createWindow();

  // ---- IPC ----
  ipcMain.handle('catalog', () => CATALOG);
  ipcMain.handle('models:list', () => listInstalled());
  ipcMain.handle('models:download', (e, id) => downloadModel(id));
  ipcMain.handle('models:cancel', (e, id) => cancelDownload(id));
  ipcMain.handle('models:delete', (e, id) => deleteModel(id));
  ipcMain.handle('models:addLocal', async (e, p, mm) => addLocalModel(p, mm));
  ipcMain.handle('models:setMmproj', (e, id, p) => setCustomMmproj(id, p));
  ipcMain.handle('models:pickFile', async (e, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [{ name: 'GGUF models', extensions: ['gguf'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('models:inspect', (e, p) => { try { return { ok: true, info: inspectGguf(p) }; } catch (er) { return { ok: false, error: er.message }; } });

  ipcMain.handle('engine:startLLM', (e, opts) => startLLM(opts));
  ipcMain.handle('engine:stopLLM', () => stopLLM());
  ipcMain.handle('engine:llamaStatus', () => llamaStatus());
  ipcMain.handle('engine:chatStop', () => chatStop());
  ipcMain.handle('engine:chat', async (e, messages, opts) => {
    try {
      const r = await chatStream(messages, opts);
      return { ok: true, text: r.text, stopped: !!r.stopped, finish: r.finish || null, note: r.note || null };
    }
    catch (er) { return { ok: false, error: extractApiError(er.message) }; }
  });
  ipcMain.handle('engine:chatReset', () => ({ ok: true }));

  ipcMain.handle('engine:startSD', (e, entry) => startSD(entry));
  ipcMain.handle('engine:stopSD', () => stopSD());
  ipcMain.handle('engine:sdStatus', () => sdStatus());
  ipcMain.handle('engine:sdGen', async (e, params) => {
    try { return { ok: true, ...(await sdGenerate(params)) }; }
    catch (er) { return { ok: false, error: er.message }; }
  });
  ipcMain.handle('engine:sdJob', async (e, jobId) => {
    if (!sdProc) return { ok: false, error: 'not running' };
    const r = await get(sdProc.port, '/sdcpp/v1/jobs/' + jobId);
    return { ok: true, job: r.json };
  });
  ipcMain.handle('engine:sdCancel', async (e, jobId) => {
    if (!sdProc) return { ok: false };
    const r = await post(sdProc.port, '/sdcpp/v1/jobs/' + jobId + '/cancel', {});
    return { ok: true };
  });
  ipcMain.handle('engine:sdCaps', async () => {
    if (!sdProc) return { ok: false };
    const r = await get(sdProc.port, '/sdcpp/v1/capabilities');
    return { ok: true, caps: r.json };
  });

  ipcMain.handle('hw:detect', () => detectHardware());
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (e, s) => { settings = { ...settings, ...s }; saveSettings(); return settings; });
  ipcMain.handle('app:saveImage', (e, b64, name) => saveImage(b64, name));
  ipcMain.handle('app:openFolder', (e, p) => { shell.openPath(p || PICTURES_DIR); return { ok: true }; });
  ipcMain.handle('app:openPath', (e, p) => { shell.showItemInFolder(p); return { ok: true }; });
  ipcMain.handle('app:paths', () => ({ models: MODELS_DIR, pictures: PICTURES_DIR, userData: USER_DATA, engines: ENGINES }));

  // ---- projects ----
  ipcMain.handle('project:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('project:tree', (e, root) => {
    if (!root || !fs.existsSync(root)) return { ok: false, error: 'Folder not found' };
    return { ok: true, root, name: path.basename(root), files: projectTree(root) };
  });
  ipcMain.handle('project:read', (e, root, rel) => projectRead(root, rel));
  ipcMain.handle('project:write', (e, root, rel, content) => projectWrite(root, rel, content));
  ipcMain.handle('project:create', (e, root, rel, isDir) => projectCreate(root, rel, !!isDir));
  ipcMain.handle('project:delete', (e, root, rel) => projectDelete(root, rel));
  ipcMain.handle('project:rename', (e, root, rel, to) => projectRename(root, rel, to));
});

app.on('window-all-closed', () => {
  stopLLM(); stopSD();
  app.quit();
});
app.on('before-quit', () => { stopLLM(); stopSD(); });
