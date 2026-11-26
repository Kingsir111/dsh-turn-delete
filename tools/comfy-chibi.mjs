// Generate the chibi whale-girl for the dialog decoration through the local
// ComfyUI (Anima / Qwen-Image stack), then save the raw render.
//
//   node tools/comfy-chibi.mjs [outfile]
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const BASE = 'http://127.0.0.1:8188'
const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'docs', 'design', 'chibi-raw.png'))

const POSITIVE_OVERRIDE = process.argv[3]
const SEED = Number(process.argv[4] ?? 20261126)
const POSITIVE = [
  'masterpiece, best quality, very aesthetic, chibi, super deformed, cute',
  '1girl, solo, whale girl, blue hair, very long wavy hair, blue eyes, big sparkling eyes',
  'whale fin ears, white frilled maid headdress, hair ribbon, navy maid dress, white apron, black bowtie',
  'blush, gentle smile, looking at viewer, upper body',
  'simple background, white background, flat color, thick outlines, sticker style, clean lineart',
].join(', ')

const NEGATIVE = [
  'worst quality, low quality, normal quality, bad anatomy, bad hands, extra fingers, missing fingers',
  'text, watermark, signature, logo, jpeg artifacts, blurry, monochrome',
  'multiple views, reference sheet, picture frame, realistic, 3d',
].join(', ')

const graph = {
  1: { class_type: 'UNETLoader', inputs: { unet_name: 'anima_baseV10.safetensors', weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
  4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: POSITIVE_OVERRIDE ?? POSITIVE } },
  5: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
  6: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 832, batch_size: 1 } },
  7: {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
      seed: SEED, steps: 28, cfg: 4.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    },
  },
  8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
  9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'turn-delete-chibi' } },
}

const clientId = randomUUID()
const submit = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: clientId }),
})
const accepted = await submit.json()
if (accepted.prompt_id === undefined) {
  console.error('submit rejected:', JSON.stringify(accepted).slice(0, 600))
  process.exit(1)
}
console.log(`queued: ${accepted.prompt_id}`)

const deadline = Date.now() + 8 * 60 * 1000
let images
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 2500))
  const history = await (await fetch(`${BASE}/history/${accepted.prompt_id}`)).json()
  const entry = history[accepted.prompt_id]
  if (entry === undefined) continue
  if (entry.status?.status_str === 'error') {
    console.error('generation failed:', JSON.stringify(entry.status).slice(0, 800))
    process.exit(1)
  }
  const outputs = entry.outputs ?? {}
  for (const node of Object.values(outputs)) {
    if (Array.isArray(node.images) && node.images.length > 0) images = node.images
  }
  if (images !== undefined) break
}

if (images === undefined) {
  console.error('timed out waiting for the render')
  process.exit(1)
}

const first = images[0]
const url = `${BASE}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder ?? '')}&type=${encodeURIComponent(first.type ?? 'output')}`
const png = Buffer.from(await (await fetch(url)).arrayBuffer())
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, png)
console.log(`saved ${OUT} (${(png.length / 1024).toFixed(0)} KB) from ${first.filename}`)

