// Generate the DeepSeek whale-girl on the moss base checkpoint with a character
// LoRA, so the mascot matches the model the user actually uses.
//
//   node tools/comfy-moss.mjs <loraName> <seed> <outfile> [prompt]
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const BASE = 'http://127.0.0.1:8188'
const [loraName, seedArg, outArg, promptArg, vaeArg] = process.argv.slice(2)
const VAE = vaeArg ?? 'flux2-vae.safetensors'
if (loraName === undefined || seedArg === undefined || outArg === undefined) {
  throw new Error('usage: comfy-moss.mjs <loraName> <seed> <outfile> [prompt]')
}
const OUT = path.resolve(outArg)
const SEED = Number(seedArg)

const POSITIVE = promptArg ?? [
  'masterpiece, best quality, 1girl, solo, whale girl, blue hair, very long wavy hair, blue eyes',
  'whale fin ears, white frilled maid headdress, navy maid dress, white apron, black bowtie',
  'upper body, head tilted, one eyebrow raised, mouth slightly open, puzzled expression',
  'one hand raised with index finger pointing to the left, other hand at waist',
  'looking at viewer, blush, cel shading, clean lineart, thick outline',
  'simple background, white background, no text',
].join(', ')

const NEGATIVE = [
  'worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers',
  'text, watermark, signature, logo, jpeg artifacts, blurry, monochrome',
  'multiple views, reference sheet, picture frame, realistic, 3d, photo',
].join(', ')

const graph = {
  1: { class_type: 'UNETLoader', inputs: { unet_name: 'moss_image_heal_int8_convrot.safetensors', weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3.5_9b_int8_convrot.safetensors', type: 'moss_image', device: 'default' } },
  9: { class_type: 'VAELoader', inputs: { vae_name: VAE } },
  3: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: POSITIVE } },
  4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1024, batch_size: 1 } },
  6: {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
      seed: SEED, steps: 24, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    },
  },
  7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['9', 0] } },
  8: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'turn-delete-moss' } },
}

if (loraName !== undefined && loraName !== 'none') {
  graph[10] = {
    class_type: 'LoraLoader',
    inputs: { model: ['1', 0], clip: ['2', 0], lora_name: loraName, strength_model: 0.85, strength_clip: 0.85 },
  }
  graph[6].inputs.model = ['10', 0]
  graph[3].inputs.clip = ['10', 1]
  graph[4].inputs.clip = ['10', 1]
}

const submit = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
})
const accepted = await submit.json()
if (accepted.prompt_id === undefined) {
  console.error('submit rejected:', JSON.stringify(accepted).slice(0, 600))
  process.exit(1)
}
console.log(`queued ${accepted.prompt_id} (lora=${loraName}, seed=${SEED})`)

const deadline = Date.now() + 8 * 60 * 1000
let images
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 2500))
  const history = await (await fetch(`${BASE}/history/${accepted.prompt_id}`)).json()
  const entry = history[accepted.prompt_id]
  if (entry === undefined) continue
  if (entry.status?.status_str === 'error') {
    console.error('generation failed:', JSON.stringify(entry.status).slice(0, 900))
    process.exit(1)
  }
  for (const node of Object.values(entry.outputs ?? {})) {
    if (Array.isArray(node.images) && node.images.length > 0) images = node.images
  }
  if (images !== undefined) break
}

if (images === undefined) {
  console.error('timed out')
  process.exit(1)
}

const first = images[0]
const url = `${BASE}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder ?? '')}&type=${encodeURIComponent(first.type ?? 'output')}`
const png = Buffer.from(await (await fetch(url)).arrayBuffer())
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, png)
console.log(`saved ${OUT} (${(png.length / 1024).toFixed(0)} KB)`)



