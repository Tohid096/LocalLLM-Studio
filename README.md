# LocalLLM Studio

Run large language models, vision models and image generation **fully offline
on your Windows PC** — private chat with PDF/image context, and a local image
studio. works on any x64 Windows 10/11 machine with a GPU driver.

Built with Electron + [llama.cpp](https://github.com/ggml-org/llama.cpp)
(Vulkan build) for LLM/VLM chat and
[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)
(Vulkan build) for image generation. **MIT licensed.**

> Looking for the ready-to-run app? Download the installer from the


## What's new in v2.2.1

- **GPU out-of-memory no longer kills a model load.** iGPU Vulkan memory is a
  shared heap that is often much smaller than your installed RAM (a 14B model
  can fail with `ErrorOutOfDeviceMemory` on a 24 GB machine). The loader now
  detects that and automatically retries with fewer GPU layers (99 → 40 → 20 →
  8 → 0/CPU), tells you what it is doing, and remembers the layer count that
  fit so the next load of that model is instant. Reset it any time in
  Settings → Chat engine → "GPU auto-tuning memory".
- **Chat uses the full window width.** Formatted answers no longer collapse to
  a ~60% column after generation finishes — messages, code blocks and tables
  span the whole chat pane.
- **Faster, smoother long answers.** Live markdown re-rendering is throttled to
  ~10 fps, and finished messages are cached — completing a reply no longer
  re-highlights the entire conversation. Each answer also shows its speed
  (~tok/s · seconds).
- **Partial answers survive engine hiccups.** If the engine connection drops
  mid-answer, the text generated so far is kept (with a ▶ Continue to finish it)
  instead of being replaced by a connection error.
- **Higher default answer length.** Max new tokens defaults to 4096 (up from
  2048), so big code files complete without pressing Continue.
- **New flagship model: Qwen 3 Coder 30B A3B (MoE)** — for 24 GB RAM machines,
  only ~3B active parameters so it writes whole projects fast.

## What's new in v2.2.0

- **Projects tab — a real multi-file workspace with an agent.** Open any folder,
  browse/edit/save files, and give the local model a task: it reads the files you
  add to its context, writes/creates real project files (```write:path``` blocks
  with Apply / auto-apply), and loops plan → write → check until it replies DONE.
  Step limit + Stop button keep it under your control.
- **Syntax-highlighted code + Copy button.** Chat (and the agent) render every
  code block with offline highlight.js, a language label and a one-click copy
  button. Full markdown: headings, lists, tables, quotes, links.
- **No more "request exceeds context" dead ends.** Prompts are auto-fitted to
  the model's context (older turns trimmed, document budgets respected), with an
  automatic short-history retry as a safety net. Default context is now 8192
  tokens and default max tokens 2048.
- **No more "Conversation roles must alternate" errors.** History is normalized
  before every request (consecutive same-role turns merged, one system prompt).
- **Continue & Regenerate.** Answers that hit the token limit get a ▶ Continue
  button that finishes them *without repeating anything*; ↻ Regenerate replaces
  only the last answer instead of restarting the chat.
- **Vision-safe history.** Images in an old conversation no longer break the
  request when a non-vision model is loaded — they degrade to a text note.
- **Stronger models.** Qwen 2.5 Coder 1.5B/3B/7B/14B, Qwen 3 4B Instruct 2507,
  Qwen 2.5 7B and DeepSeek-R1 7B — picked to actually finish long code answers.

## What's new in v2.1.0

- **Documents & code files are actually read now.** A bug in v2.0.0 computed
  the attachment text but never sent it to the model — the AI never saw your
  PDF/text/code. Attachments now travel with every request, budgeted by a new
  "Document context" setting (default 12,000 chars) so long documents can't
  overflow the model's context window. Multi-turn Q&A over one document
  works: the latest attachment stays fully in context on every turn.
- **Stop button.** Stop any generation mid-stream; the text generated so far
  is kept in the chat and in the conversation history (marked
  "stopped by user").
- **📎 Doc / Code picker**: 60+ extensions — PDF, Markdown, JSON/CSV/YAML,
  Python, JavaScript/TypeScript, Java, C/C++, C#, Go, Rust, SQL, shell,
  HTML/CSS and more. Multiple files at once; binary files are rejected with
  a clear message; scanned PDFs (no text layer) are detected and explained.
- Images attached to chat are downscaled to max 1024px (faster VLM input,
  history that actually fits in local storage instead of silently failing).
- Autoscroll no longer hijacks reading: scroll up while the AI types and the
  view stays where you put it.
- Error messages are no longer fed back to the model as if the assistant had
  said them.

## Features

**Chat**
- Streaming generation with Stop (keeps partial text), Continue, Regenerate
- Syntax-highlighted code blocks with copy buttons, full markdown rendering
- System prompt, temperature / top-p / max tokens controls
- Context auto-fitting: long conversations and documents never overflow the model
- Auto thread count = physical cores (override in Settings)

**Projects (agent workspace)**
- Open any folder: file tree, editor, create/rename/delete, Ctrl+S save
- Project Agent: multi-file context, real file writes (write:/append: blocks),
  multi-step loop until DONE, auto-apply toggle, step limit + Stop

**Vision (VLM)**
- Vision models load with their `mmproj` projector — auto-paired on download
- Catalog: SmolVLM 500M, Qwen2-VL 2B, Qwen2.5-VL 3B, Gemma 3 4B
- Attach images in chat and the model actually sees them

**Image Studio**
- Five models: DreamShaper 8, SD-Turbo, SD 1.5, SDXL-Turbo, FLUX.1-schnell
  (Q4_K_S GGUF)
- Full size / steps / seed / sampler / negative prompt control, async jobs
  with progress, save to Pictures

**Documents**
- Built-in pdf.js viewer: renders every page, extracts full text with page
  markers, hands it to the AI as context — "Ask AI about this document"

**Models**
- 15-entry curated catalog with resumable multi-file downloads
  (model + mmproj packs, FLUX 4-part packs)
- Bring your own `.gguf`: local scan + GGUF inspection, manual mmproj pairing

**Hardware**
- Hardware center: CPU/RAM, Vulkan device list (`--list-devices`), NPU
  detection, active engine status
- Honest engineering: GGUF models execute on CPU + iGPU (Vulkan), not on NPUs
  (that would need ONNX graphs) — the app tells you exactly what's in use

## Requirements

- Windows 10 or 11, x64
- A GPU driver with Vulkan support (AMD / Intel / NVIDIA — iGPUs included)
- ~4 GB free RAM for 1–3B Q4 models, more for larger ones

## Quick start (from source)

```powershell
# 1. install dependencies
npm install

# 2. fetch the engine binaries (llama.cpp + stable-diffusion.cpp, Vulkan x64)
powershell -ExecutionPolicy Bypass -File scripts\get-engines.ps1

# 3. run
npm start
```

Linux/macOS contributors: use `scripts/get-engines.sh` (builds the Linux
Vulkan binaries) — the app itself is Windows-only today.

## Building the installer

```powershell
npm run dist        # electron-builder -> NSIS x64 installer in ..\release\
```

The NSIS script `build/installer.nsi` (per-user install, no admin) is also
included if you prefer to build the installer manually with NSIS after
`electron-builder --dir`.

## Repository layout

```
main.js            Electron main process: engines, IPC, downloads, settings
preload.js         contextBridge API exposed to the renderer
catalog.js         curated model catalog (chat / vision / image) + recipes
gguf.js            GGUF header inspection (arch, quants, context, mmproj)
renderer/
  index.html       app shell (CSP-locked)
  css/style.css    UI styling
  js/app.js        navigation, boot, engine badges
  js/chat.js       chat tab: streaming, presets, attachments
  js/models.js     model catalog, downloads, local models, mmproj pairing
  js/studio.js     image generation tab
  js/docs.js       documents tab (pdf.js viewer + text extraction)
  js/hardware.js   hardware center tab
  js/api.js        typed wrapper over window.api (preload bridge)
  vendor/          pdf.js (pdf.min.js + pdf.worker.min.js)
build/             app icon + NSIS installer script
scripts/           get-engines.ps1 / get-engines.sh — engine bootstrap
engines/           runtime binaries (NOT in git) — see engines/README.md
.github/           CI: JS syntax checks on every push
```

## How acceleration works

- **iGPU**: both engines ship in Vulkan builds; model layers offload to the
  GPU automatically (`-ngl 99`, Vulkan device selectable in Settings).
  Watch GPU usage climb in Task Manager while generating.
- **CPU**: llama.cpp's multi-variant CPU backends (AVX2, AVX-512, Zen 4
  kernels) are runtime-dispatched; the app defaults threads to physical cores.
- **NPU**: detected and shown, but not used for GGUF inference — llama.cpp
  has no XDNA2 execution path. See the Hardware tab note in-app.

## Troubleshooting

- **"engine missing" badge** — run `scripts/get-engines.ps1`, then restart.
- **No Vulkan devices listed** — update your GPU driver; on hybrid laptops
  force the dedicated GPU in Windows Graphics Settings.
- **Slow generation** — Settings → Performance: raise GPU offload layers,
  keep threads = physical cores, prefer Q4_K_M quants.
- **Gray/washed images** — you are on an old engine; re-run
  `scripts/get-engines.ps1` (validates colorful output by design).

## License

MIT — see [LICENSE](LICENSE). Third-party engines keep their own MIT /
Apache-2.0 licenses under `engines/` (not part of this repository).
