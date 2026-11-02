// LocalLLM Studio - model catalog
// All URLs verified resumable (HTTP 206 range support, no auth wall).
// v2.2.0: strong coding + long-output models (Qwen2.5-Coder family, Qwen3-4B, Qwen2.5-7B,
//         DeepSeek-R1 7B) — these finish big code answers instead of stalling mid-way.
// v2.2.1: added Qwen3-Coder-30B-A3B MoE — flagship for 24 GB RAM machines.

const HF = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

const CATALOG = {
  chat: [
    {
      id: 'llama-3.2-1b',
      name: 'Llama 3.2 1B Instruct',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 807694464,
      desc: 'Meta\'s compact instruct model. Fast, great for everyday chat on CPU or iGPU.',
      ctx: 8192,
      files: [{ url: HF('bartowski/Llama-3.2-1B-Instruct-GGUF', 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'), path: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-coder-1.5b',
      name: 'Qwen 2.5 Coder 1.5B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 986048800,
      desc: 'Code specialist that fits in tiny RAM: HTML/CSS/JS, Python, SQL. Good first coding model.',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF', 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-1.5b',
      name: 'Qwen 2.5 1.5B Instruct',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 986048768,
      desc: 'Alibaba\'s strong all-rounder. Excellent multilingual + math skills for its size.',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-1.5B-Instruct-GGUF', 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'deepseek-r1-1.5b',
      name: 'DeepSeek R1 Distill 1.5B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 1117320800,
      desc: 'Reasoning model (Qwen distill). Shows step-by-step thinking before answering.',
      ctx: 32768,
      files: [{ url: HF('bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF', 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf'), path: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf' }]
    },
    {
      id: 'gemma-2-2b',
      name: 'Gemma 2 2B IT',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 1708582752,
      desc: 'Google\'s 2B instruct model. Punchy quality close to much larger models.',
      ctx: 8192,
      files: [{ url: HF('bartowski/gemma-2-2b-it-GGUF', 'gemma-2-2b-it-Q4_K_M.gguf'), path: 'gemma-2-2b-it-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-coder-3b',
      name: 'Qwen 2.5 Coder 3B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 1929903360,
      desc: 'Sweet spot for iGPU machines: full websites, multi-file projects, clean long code outputs.',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-Coder-3B-Instruct-GGUF', 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'llama-3.2-3b',
      name: 'Llama 3.2 3B Instruct',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 2019377696,
      desc: 'Bigger Llama sibling with noticeably better knowledge and writing.',
      ctx: 8192,
      files: [{ url: HF('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'), path: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen3-4b',
      name: 'Qwen 3 4B Instruct 2507',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 2497281120,
      recommended: true,
      desc: '★ New-generation model: excellent instruction following, keeps generating until the answer is actually finished. Great for notes, essays and the Project Agent.',
      ctx: 32768,
      files: [{ url: HF('unsloth/Qwen3-4B-Instruct-2507-GGUF', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'), path: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-coder-7b',
      name: 'Qwen 2.5 Coder 7B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 4683074336,
      recommended: true,
      desc: '★ The coding model to have: complete apps, JWT auth pages, algorithms — writes long files that actually end. Best pick for the Projects agent (8 GB+ RAM recommended).',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-7b',
      name: 'Qwen 2.5 7B Instruct',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 4683074240,
      desc: 'Best general 7B chat: balanced writing, knowledge and code. 8 GB+ RAM recommended.',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'deepseek-r1-7b',
      name: 'DeepSeek R1 Distill 7B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 4683073504,
      desc: '7B reasoning model: thinks step-by-step, strong at math and debugging. 8 GB+ RAM recommended.',
      ctx: 32768,
      files: [{ url: HF('bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF', 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf'), path: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen2.5-coder-14b',
      name: 'Qwen 2.5 Coder 14B',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 8988111072,
      desc: 'Flagship-class local coder for 16 GB+ RAM / strong iGPU machines. Whole-project refactors and tricky architecture work.',
      ctx: 32768,
      files: [{ url: HF('bartowski/Qwen2.5-Coder-14B-Instruct-GGUF', 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf' }]
    },
    {
      id: 'qwen3-coder-30b-a3b',
      name: 'Qwen 3 Coder 30B A3B (MoE)',
      category: 'chat',
      quant: 'Q4_K_M',
      size: 18556689568,
      recommended: true,
      desc: '★ Strongest coder for 24 GB RAM machines: MoE with only ~3B active parameters, so it writes whole projects at speed. If GPU memory is tight it falls back to fewer GPU layers automatically.',
      ctx: 262144,
      files: [{ url: HF('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'), path: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf' }]
    }
  ],

  vision: [
    {
      id: 'smolvlm-500m',
      name: 'SmolVLM 500M',
      category: 'vision',
      quant: 'Q8_0',
      size: 545590272,
      desc: 'Tiny vision-language model. Reads images, screenshots and photos. Best for iGPU speed.',
      ctx: 8192,
      needsMmproj: true,
      files: [
        { url: HF('ggml-org/SmolVLM-500M-Instruct-GGUF', 'SmolVLM-500M-Instruct-Q8_0.gguf'), path: 'SmolVLM-500M-Instruct-Q8_0.gguf' },
        { url: HF('ggml-org/SmolVLM-500M-Instruct-GGUF', 'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf'), path: 'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf', mmproj: true }
      ]
    },
    {
      id: 'qwen2-vl-2b',
      name: 'Qwen2-VL 2B Instruct',
      category: 'vision',
      quant: 'Q4_K_M',
      size: 1695930304,
      desc: 'Strong vision model: OCR, charts, documents, multi-image comparison.',
      ctx: 32768,
      needsMmproj: true,
      files: [
        { url: HF('ggml-org/Qwen2-VL-2B-Instruct-GGUF', 'Qwen2-VL-2B-Instruct-Q4_K_M.gguf'), path: 'Qwen2-VL-2B-Instruct-Q4_K_M.gguf' },
        { url: HF('ggml-org/Qwen2-VL-2B-Instruct-GGUF', 'mmproj-Qwen2-VL-2B-Instruct-Q8_0.gguf'), path: 'mmproj-Qwen2-VL-2B-Instruct-Q8_0.gguf', mmproj: true }
      ]
    },
    {
      id: 'qwen2.5-vl-3b',
      name: 'Qwen2.5-VL 3B Instruct',
      category: 'vision',
      quant: 'Q4_K_M',
      size: 2774658784,
      desc: 'Newer Qwen vision model. Excellent OCR, table and UI understanding.',
      ctx: 32768,
      needsMmproj: true,
      files: [
        { url: HF('ggml-org/Qwen2.5-VL-3B-Instruct-GGUF', 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf'), path: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf' },
        { url: HF('ggml-org/Qwen2.5-VL-3B-Instruct-GGUF', 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf'), path: 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf', mmproj: true }
      ]
    },
    {
      id: 'gemma-3-4b-vision',
      name: 'Gemma 3 4B Instruct (Vision)',
      category: 'vision',
      quant: 'Q4_K_M',
      size: 3341008000,
      desc: 'Google\'s multimodal Gemma 3. High-quality image understanding and chat.',
      ctx: 131072,
      needsMmproj: true,
      files: [
        { url: HF('ggml-org/gemma-3-4b-it-GGUF', 'gemma-3-4b-it-Q4_K_M.gguf'), path: 'gemma-3-4b-it-Q4_K_M.gguf' },
        { url: HF('ggml-org/gemma-3-4b-it-GGUF', 'mmproj-model-f16.gguf'), path: 'mmproj-gemma-3-4b-f16.gguf', mmproj: true }
      ]
    }
  ],

  image: [
    {
      id: 'dreamshaper-8',
      name: 'DreamShaper 8',
      category: 'image',
      kind: 'sd1-dir',
      recipe: 'sd1-checkpoint',
      size: 2132604988,
      desc: 'The all-round quality king for SD1.5-class: crisp, colorful, artistic. 2.1 GB - our recommended starter.',
      defaults: { width: 512, height: 512, steps: 25, cfg: 7, sampler: 'euler_a', scheduler: 'default', negative: 'blurry, low quality, deformed, watermark, text' },
      files: [
        { url: HF('Lykon/dreamshaper-8', 'unet/diffusion_pytorch_model.fp16.safetensors'), path: 'ds8/unet/diffusion_pytorch_model.safetensors' },
        { url: HF('Lykon/dreamshaper-8', 'vae/diffusion_pytorch_model.fp16.safetensors'), path: 'ds8/vae/diffusion_pytorch_model.safetensors' },
        { url: HF('Lykon/dreamshaper-8', 'text_encoder/model.fp16.safetensors'), path: 'ds8/text_encoder/model.safetensors' },
        { url: '', path: 'ds8/model_index.json', inline: 'json' }
      ]
    },
    {
      id: 'sd-turbo',
      name: 'SD-Turbo 512',
      category: 'image',
      kind: 'sd-file',
      recipe: 'sd-turbo',
      size: 5214561328,
      desc: '1-step distilled SD 2.1 turbo. Lightning fast drafts at 512px (fp32 file, loads as-is).',
      defaults: { width: 512, height: 512, steps: 2, cfg: 1, sampler: 'euler', scheduler: 'discrete', negative: '' },
      files: [{ url: HF('stabilityai/sd-turbo', 'sd_turbo.safetensors'), path: 'sd_turbo.safetensors' }]
    },
    {
      id: 'sd15',
      name: 'Stable Diffusion 1.5',
      category: 'image',
      kind: 'sd-file',
      recipe: 'sd1-checkpoint',
      size: 4265146304,
      desc: 'The classic SD 1.5 base. Huge ecosystem of LoRAs and styles.',
      defaults: { width: 512, height: 512, steps: 25, cfg: 7, sampler: 'euler_a', scheduler: 'default', negative: 'blurry, low quality, deformed, watermark, text' },
      files: [{ url: HF('stable-diffusion-v1-5/stable-diffusion-v1-5', 'v1-5-pruned-emaonly.safetensors'), path: 'v1-5-pruned-emaonly.safetensors' }]
    },
    {
      id: 'sdxl-turbo',
      name: 'SDXL-Turbo 1024',
      category: 'image',
      kind: 'sd-file',
      recipe: 'sdxl-turbo',
      size: 6938081905,
      desc: 'SDXL distilled to 1-4 steps. Big 1024px canvases in seconds on the iGPU.',
      defaults: { width: 1024, height: 1024, steps: 4, cfg: 1, sampler: 'euler', scheduler: 'discrete', negative: '' },
      files: [{ url: HF('stabilityai/sdxl-turbo', 'sd_xl_turbo_1.0_fp16.safetensors'), path: 'sd_xl_turbo_1.0_fp16.safetensors' }]
    },
    {
      id: 'flux-schnell-q4',
      name: 'FLUX.1 [schnell] Q4',
      category: 'image',
      kind: 'flux',
      recipe: 'flux1-schnell',
      size: 9633944528,
      desc: 'Top-tier photoreal quality (Black Forest Labs) in 4 steps. Needs ~10 GB disk + 16 GB RAM recommended.',
      defaults: { width: 1024, height: 1024, steps: 4, cfg: 1, sampler: 'euler', scheduler: 'default', negative: '' },
      files: [
        { url: HF('city96/FLUX.1-schnell-gguf', 'flux1-schnell-Q4_K_S.gguf'), path: 'flux/flux1-schnell-Q4_K_S.gguf' },
        { url: HF('comfyanonymous/flux_text_encoders', 'clip_l.safetensors'), path: 'flux/clip_l.safetensors' },
        { url: HF('city96/t5-v1_1-xxl-encoder-gguf', 't5-v1_1-xxl-encoder-Q3_K_M.gguf'), path: 'flux/t5-v1_1-xxl-encoder-Q3_K_M.gguf' },
        { url: HF('second-state/FLUX.1-schnell-GGUF', 'ae.safetensors'), path: 'flux/ae.safetensors' }
      ]
    }
  ]
};

// model_index.json for DreamShaper 8 (diffusers layout descriptor)
CATALOG.DREAMSHAPER_INDEX = {
  _class_name: 'StableDiffusionPipeline',
  _diffusers_version: '0.21.0.dev0',
  _name_or_path: 'lykon-models/dreamshaper-8',
  requires_safety_checker: false,
  scheduler: ['diffusers', 'DEISMultistepScheduler'],
  text_encoder: ['transformers', 'CLIPTextModel'],
  tokenizer: ['transformers', 'CLIPTokenizer'],
  unet: ['diffusers', 'UNet2DConditionModel'],
  vae: ['diffusers', 'AutoencoderKL']
};

const VISION_ARCH_HINTS = ['llava', 'moondream', 'minicpmv', 'minicpm-v', 'qwen2vl', 'qwen2.5vl', 'smolvlm', 'gemma3', 'pixtral', 'idefics', 'internvl'];

module.exports = { CATALOG, VISION_ARCH_HINTS };
