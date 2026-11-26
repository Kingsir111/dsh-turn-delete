// Print the loader / sampler / encoder settings of a ComfyUI UI workflow so the
// same stack can be replayed through the API.
import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
const interesting = /Loader|KSampler|Sampler|Latent|Encode|VAE|Lora|Image/i

const seen = new Set()
for (const node of json.nodes ?? []) {
  if (!interesting.test(node.type)) continue
  const widgets = (node.widgets_values ?? []).map(value =>
    typeof value === 'string' ? value : JSON.stringify(value))
  const key = `${node.type}|${widgets.join('§')}`
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`${node.type} :: ${widgets.slice(0, 6).join(' | ').slice(0, 260)}`)
}
