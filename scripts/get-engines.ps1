# LocalLLM Studio - engine bootstrap (Windows)
# Downloads the official Vulkan x64 builds of llama.cpp and
# stable-diffusion.cpp into .\engines\ (llama\ and sd\).
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\get-engines.ps1
#         optional flags:
#           -LlamaTag b12020          pin a llama.cpp release tag
#           -SdTag   master-1030-0a06712   pin a stable-diffusion.cpp tag
#           -Cpu                      fetch CPU-only llama build too (fallback)

param(
    [string]$LlamaTag = "",
    [string]$SdTag = "",
    [switch]$Cpu
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root   = Split-Path -Parent $PSScriptRoot
$LlamaDir = Join-Path $Root "engines\llama"
$SdDir     = Join-Path $Root "engines\sd"
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("localllm-engines-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $LlamaDir, $SdDir, $Tmp | Out-Null

$Headers = @{ "User-Agent" = "LocalLLM-Studio-setup" }

function Get-LatestAssetUrl([string]$Repo, [string]$Pattern) {
    try {
        $rel = Invoke-RestMethod -Headers $Headers -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 30
        $asset = $rel.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
        if ($asset) { return @{ url = $asset.browser_download_url; tag = $rel.tag_name } }
    } catch { Write-Host "  (GitHub API unreachable: $($_.Exception.Message) - falling back to pinned release)" }
    return $null
}

function Get-PinnedAssetUrl([string]$Repo, [string]$Tag, [string]$AssetName) {
    return @{ url = "https://github.com/$Repo/releases/download/$Tag/$AssetName"; tag = "$Tag (pinned)" }
}

function Fetch-AndExtract([string]$Name, [hashtable]$Asset, [string]$Dest) {
    if (-not $Asset) { Write-Host "!! no asset resolved for $Name - download manually (see engines/README.md)"; return $false }
    $zip = Join-Path $Tmp ($Name + ".zip")
    Write-Host ("==> {0}: {1}" -f $Name, $Asset.tag)
    Write-Host ("    " + $Asset.url)
    Invoke-WebRequest -Headers $Headers -Uri $Asset.url -OutFile $zip -TimeoutSec 1800
    Write-Host "    extracting..."
    $stage = Join-Path $Tmp ($Name + "-x")
    Expand-Archive -Path $zip -DestinationPath $stage -Force
    # zips unpack either flat or into a single subfolder - normalize
    $items = Get-ChildItem $stage
    if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $items = Get-ChildItem $items[0].FullName }
    foreach ($i in $items) { Copy-Item $i.FullName -Destination $Dest -Force -Recurse }
    return $true
}

$ok = $true

# ---- llama.cpp (Vulkan x64) ----
$llama = $null
if ($LlamaTag) {
    $llama = Get-PinnedAssetUrl "ggml-org/llama.cpp" $LlamaTag ("llama-" + $LlamaTag + "-bin-win-vulkan-x64.zip")
} else {
    $llama = Get-LatestAssetUrl "ggml-org/llama.cpp" "^llama-.*-bin-win-vulkan-x64\.zip$"
    if (-not $llama) { $llama = Get-PinnedAssetUrl "ggml-org/llama.cpp" "b12020" "llama-b12020-bin-win-vulkan-x64.zip" }
}
if (-not (Fetch-AndExtract "llama.cpp-vulkan" $llama $LlamaDir)) { $ok = $false }

# ---- stable-diffusion.cpp (Vulkan x64) ----
$sd = $null
if ($SdTag) {
    $assetName = "sd-master-" + ($SdTag -replace '^master-\d+-', '') + "-bin-win-vulkan-x64.zip"
    $sd = Get-PinnedAssetUrl "leejet/stable-diffusion.cpp" $SdTag $assetName
} else {
    $sd = Get-LatestAssetUrl "leejet/stable-diffusion.cpp" "^sd-master-.*-bin-win-vulkan-x64\.zip$"
    if (-not $sd) { $sd = Get-PinnedAssetUrl "leejet/stable-diffusion.cpp" "master-1030-0a06712" "sd-master-0a06712-bin-win-vulkan-x64.zip" }
}
if (-not (Fetch-AndExtract "stable-diffusion.cpp-vulkan" $sd $SdDir)) { $ok = $false }

# ---- optional CPU-only llama fallback ----
if ($Cpu) {
    $llamaCpu = Get-LatestAssetUrl "ggml-org/llama.cpp" "^llama-.*-bin-win-avx2-x64\.zip$"
    Fetch-AndExtract "llama.cpp-cpu" $llamaCpu $LlamaDir | Out-Null
}

Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

# ---- verify ----
Write-Host ""
$llamaServer = Join-Path $LlamaDir "llama-server.exe"
$sdServer    = Join-Path $SdDir "sd-server.exe"
$vulkan      = Join-Path $LlamaDir "ggml-vulkan.dll"
$haveLlama = Test-Path $llamaServer
$haveSd    = Test-Path $sdServer
$haveVulkan = Test-Path $vulkan

if ($haveLlama) { Write-Host "[OK] engines\llama\llama-server.exe" } else { Write-Host "[MISSING] engines\llama\llama-server.exe"; $ok = $false }
if ($haveVulkan) { Write-Host "[OK] engines\llama\ggml-vulkan.dll (iGPU backend present)" } else { Write-Host "[MISSING] engines\llama\ggml-vulkan.dll"; $ok = $false }
if ($haveSd)    { Write-Host "[OK] engines\sd\sd-server.exe" } else { Write-Host "[MISSING] engines\sd\sd-server.exe"; $ok = $false }

Write-Host ""
if ($ok) {
    Write-Host "Engines ready. Next:  npm install ; npm start"
    exit 0
} else {
    Write-Host "Some engines are missing - see engines/README.md for manual download URLs."
    exit 1
}
