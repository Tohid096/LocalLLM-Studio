# Contributing to LocalLLM Studio

Thanks for your interest! This is a small, focused project — keep changes
tight and documented.

## Development setup

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\get-engines.ps1
npm start
```

## Ground rules

- **Vanilla stack**: plain JavaScript (Electron main + renderer), no build
  step, no framework. Keep it that way unless you propose otherwise first.
- **Security**: the renderer runs under a strict CSP and talks to the main
  process only through `preload.js` (contextBridge). Never add
  `nodeIntegration` or remote content.
- **Engines** are third-party (llama.cpp / stable-diffusion.cpp); the app
  consumes their HTTP APIs. Don't vendor their binaries into the repo.
- **Models**: new catalog entries must be verified against the Hugging Face
  repo (file names, mmproj pairing) before submitting.

## Submitting changes

1. Fork, branch (`git switch -c my-feature`), commit with clear messages.
2. `node --check main.js` and every `renderer/js/*.js` you touched (CI runs
   this too).
3. Test manually on Windows: chat with a local model, generate one image,
   open one PDF.
4. Open a Pull Request describing what changed and why.

## Reporting bugs

Open an issue with: Windows version, GPU (or iGPU), the engine badge state,
and the log from `%APPDATA%\LocalLLM Studio\logs` if present.

## License

By contributing you agree your work is released under the project's
[MIT license](LICENSE).
