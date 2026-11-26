// Probe the plugin compatibility gate for candidate peer ranges.
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const boot = req('@deepseek-ai/dsh-app-boot')
const runtime = boot.getDshRuntimeVersion?.()
console.log('runtime version:', runtime)

const candidates = [
  '^0.1.5-rc.2 || ^0.2.0-rc.1',
  '>=0.1.5-rc.3 <0.3.0',
  '>=0.1.5-rc.2 <0.3.0',
  '^0.2.0-rc.1',
  '^0.2.2-rc.3',
  '>=0.1.5-rc.2 <=0.2.2-rc.3',
  '*',
]

const names = ['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-agent']
for (const range of candidates) {
  const manifest = {
    name: 'probe-plugin',
    version: '1.0.0',
    peerDependencies: Object.fromEntries(names.map(name => [name, range])),
  }
  let verdict
  try {
    const issue = boot.evaluatePluginCompatibility(manifest, [])
    verdict = issue === undefined ? 'ACCEPTED' : `REJECTED ${issue.name ?? ''} ${issue.version ?? ''} ${issue.reason ?? ''}`
  } catch (error) {
    verdict = 'THREW ' + error.message
  }
  console.log(String(range).padEnd(36), '->', verdict)
}
