#!/usr/bin/env bash
# LocalLLM Studio - engine bootstrap (Linux/macOS)
# Downloads the official Vulkan builds of llama.cpp and stable-diffusion.cpp
# into ./engines/ (llama/ and sd/). Useful for contributors testing the
# engine HTTP APIs on Linux; the app itself is Windows-only.
#
# Usage: bash scripts/get-engines.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="$ROOT/engines/llama"
SD_DIR="$ROOT/engines/sd"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

LLAMA_PINNED_TAG="b12020"
LLAMA_PINNED_ASSET="llama-b12020-bin-win-vulkan-x64.zip"
SD_PINNED_TAG="master-1030-0a06712"
SD_PINNED_ASSET="sd-master-0a06712-bin-win-vulkan-x64.zip"

# NOTE: the *Windows* zips are fetched even on Linux so the folder layout
# matches what electron-builder packs. To run the engines natively on Linux,
# build from source:
#   llama.cpp:            cmake -B build -DGGML_VULKAN=ON && cmake --build build
#   stable-diffusion.cpp: cmake -B build -DGGML_VULKAN=ON && cmake --build build

mkdir -p "$LLAMA_DIR" "$SD_DIR"

api_asset() {  # repo, pattern -> "url tag" or empty
    local repo="$1" pattern="$2"
    curl -sf -m 30 -H "User-Agent: LocalLLM-Studio-setup" \
        "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
      | python3 -c "
import json,sys
try:
    rel=json.load(sys.stdin)
    for a in rel.get('assets',[]):
        import re
        if re.search(r'''$pattern''',a['name']):
            print(a['browser_download_url']+' '+rel['tag_name']); break
except Exception: pass
" 2>/dev/null
}

fetch_extract() {  # name, url, dest
    local name="$1" url="$2" dest="$3"
    [ -z "$url" ] && { echo "!! no asset resolved for $name"; return 1; }
    echo "==> $name: $url"
    curl -fL --retry 3 -o "$TMP/$name.zip" "$url" || return 1
    local stage="$TMP/$name-x"
    mkdir -p "$stage"
    unzip -q -o "$TMP/$name.zip" -d "$stage" || return 1
    # normalize: flat or single subfolder
    local src="$stage"
    [ "$(ls -A "$stage" | wc -l)" -eq 1 ] && [ -d "$stage/$(ls -A "$stage")" ] && src="$stage/$(ls -A "$stage")"
    cp -rf "$src"/* "$dest"/
    return 0
}

ok=1

read -r LLAMA_URL LLAMA_TAG <<< "$(api_asset ggml-org/llama.cpp 'llama-.*-bin-win-vulkan-x64\.zip' || true)"
[ -z "${LLAMA_URL:-}" ] && { LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_PINNED_TAG/$LLAMA_PINNED_ASSET"; LLAMA_TAG="$LLAMA_PINNED_TAG (pinned)"; }
fetch_extract "llama.cpp-vulkan" "$LLAMA_URL" "$LLAMA_DIR" || ok=0

read -r SD_URL SD_TAG <<< "$(api_asset leejet/stable-diffusion.cpp 'sd-master-.*-bin-win-vulkan-x64\.zip' || true)"
[ -z "${SD_URL:-}" ] && { SD_URL="https://github.com/leejet/stable-diffusion.cpp/releases/download/$SD_PINNED_TAG/$SD_PINNED_ASSET"; SD_TAG="$SD_PINNED_TAG (pinned)"; }
fetch_extract "stable-diffusion.cpp-vulkan" "$SD_URL" "$SD_DIR" || ok=0

echo
[ -f "$LLAMA_DIR/llama-server.exe" ] && echo "[OK] engines/llama/llama-server.exe" || { echo "[MISSING] engines/llama/llama-server.exe"; ok=0; }
[ -f "$LLAMA_DIR/ggml-vulkan.dll" ] && echo "[OK] engines/llama/ggml-vulkan.dll (iGPU backend present)" || { echo "[MISSING] engines/llama/ggml-vulkan.dll"; ok=0; }
[ -f "$SD_DIR/sd-server.exe" ] && echo "[OK] engines/sd/sd-server.exe" || { echo "[MISSING] engines/sd/sd-server.exe"; ok=0; }

echo
if [ "$ok" -eq 1 ]; then
    echo "Engines ready. Next: npm install ; npm start (Windows) "
    exit 0
else
    echo "Some engines are missing - see engines/README.md for manual URLs."
    exit 1
fi
