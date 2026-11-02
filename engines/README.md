# Engine binaries (not part of this repository)

LocalLLM Studio drives two third-party engines through their HTTP APIs:

| Engine | Used for | Binary expected here |
|---|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (Vulkan build, Windows x64) | LLM + vision (VLM) chat | `engines/llama/llama-server.exe` (+ ggml-vulkan.dll, CPU variant DLLs, mtmd.dll, …) |
| [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (Vulkan build, Windows x64) | image generation | `engines/sd/sd-server.exe` (+ stable-diffusion.dll, ggml-vulkan.dll, …) |

Both projects are MIT licensed. Their release binaries total ~186 MB, so they
are **gitignored** — keeping this repository at ~2 MB — and fetched with one
command:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\get-engines.ps1

# Linux (for contributors testing the engine APIs)
bash scripts/get-engines.sh
```

The scripts:

1. query the GitHub API for the latest release of each project,
2. download the official **Windows x64 Vulkan** build,
3. extract it into `engines/llama/` and `engines/sd/`,
4. fall back to the pinned releases below if the API is unreachable,
5. verify `llama-server.exe` and `sd-server.exe` exist afterwards.

If the API is rate-limited or you want an exact, reproducible engine set,
download these pinned assets manually and unzip them into the folders above:

- llama.cpp `b12020`:
  `https://github.com/ggml-org/llama.cpp/releases/download/b12020/llama-b12020-bin-win-vulkan-x64.zip`
- stable-diffusion.cpp `master-1030-0a06712`:
  `https://github.com/leejet/stable-diffusion.cpp/releases/download/master-1030-0a06712/sd-master-0a06712-bin-win-vulkan-x64.zip`

Layout after bootstrap:

```
engines/
├── llama/   llama-server.exe, llama*.dll, mtmd.dll, ggml*.dll, libomp.dll, …
└── sd/      sd-server.exe, sd-cli.exe, stable-diffusion.dll, ggml*.dll, …
```

The packaged installer (`npm run dist`) bundles whatever is in `engines/`
into the app's `resources/engines/` — so run the fetch script **before**
building the installer.

## Why Vulkan builds?

- The iGPU (e.g. Radeon 860M on Ryzen AI, Intel Arc, any dGPU) executes the
  model layers through the Vulkan compute backend — check Task Manager's GPU
  graph while generating.
- The same zips also carry the multi-variant CPU backends (AVX2 / AVX-512 /
  Zen 4 kernels) with runtime dispatch, so the app falls back to a fast CPU
  path on machines without Vulkan.

## NPU note

GGUF models cannot execute on NPUs (XDNA2 et al.) — that requires ONNX
graphs and ONNX Runtime with a DirectML/VitisAI execution provider, a
different architecture from llama.cpp's runtime. LocalLLM Studio therefore
accelerates CPU + iGPU and reports NPU presence in the Hardware tab for
transparency.
