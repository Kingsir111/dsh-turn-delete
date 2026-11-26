// Local consistency check for the publishable package.
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const has = file => fs.existsSync(path.join(root, file))
const checks = []
const check = (name, ok) => checks.push([name, ok === true])

check('lib/index.js（Host 半）', has('lib/index.js'))
check('lib/client.js（浏览器半）', has('lib/client.js'))
check('lib/core.js（算法）', has('lib/core.js'))
check('dsh.bundle.patch', typeof pkg.dsh?.bundle?.patch === 'string')
check('dsh.client.platform = web', pkg.dsh?.client?.platform === 'web')
check('dsh.client.immediately', pkg.dsh?.client?.immediately === true)
check(`dsh.client.inject（${(pkg.dsh?.client?.inject ?? []).length} 项）`, (pkg.dsh?.client?.inject ?? []).length === 2)
check('exports ./client', pkg.exports?.['./client'] === './lib/client.js')
check('exports ./icon', pkg.exports?.['./icon'] === './icon.svg')
check('exports ./locale/*.json', pkg.exports?.['./locale/*.json'] === './locale/*.json')
check('peerDependencies 4 条', Object.keys(pkg.peerDependencies ?? {}).length === 4)
check('不含 engines.dsh', pkg.engines?.dsh === undefined)
const hostSource = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8')
const buildMatch = hostSource.match(/export const BUILD = '([^']+)'/u)
check(`version 与 BUILD 一致（${pkg.version}）`, buildMatch !== null && buildMatch[1] === pkg.version)
check('repository 指向已发布仓库', String(pkg.repository?.url ?? '').includes('Kingsir111/dsh-turn-delete'))
check('author 已填真实署名', String(pkg.author ?? '').includes('Kingsir') && !String(pkg.author ?? '').includes('YOUR_'))

for (const file of ['locale/zh.json', 'locale/en.json']) {
  const json = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  check(`${file} meta.title/description/detail`, Boolean(json.meta?.title && json.meta?.description && json.meta?.detail))
  check(`${file} 无残留占位符`, !JSON.stringify(json).includes('YOUR_'))
}
check('icon.svg 是合法 SVG', fs.readFileSync(path.join(root, 'icon.svg'), 'utf8').trim().startsWith('<svg'))
check('docs/DETAIL.md', has('docs/DETAIL.md'))
check('docs/DESIGN.md', has('docs/DESIGN.md'))
check('docs/TEST-REPORT.md', has('docs/TEST-REPORT.md'))
check('CHANGELOG.md', has('CHANGELOG.md'))
check('LICENSE', has('LICENSE'))
check('.gitignore', has('.gitignore'))

const client = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const requires = [...client.matchAll(/require\('([^']+)'\)/g)].map(match => match[1])
check(`client 的 require：${requires.join(', ') || '无'}`, requires.every(name => name === 'react'))
check('client 槽位 assistant-actions#turn-delete', client.includes("id: 'turn-delete'"))
check('client 用纯 DOM 建 UI', client.includes('data-dsh-turn-delete-ui'))
check('client 走 __ModuleLoader__ 自注册', client.includes('window.__ModuleLoader__.load'))

const host = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8')
check('host 三条路由', host.includes("'/dsh-turn-delete'") && host.includes("'/dsh-turn-delete/deleted'") && host.includes("'/dsh-turn-delete/import'"))
check('host inject 三项服务', host.includes("['sessions', 'agents', 'webServer']"))
check('host 用 appendPluginRecord', host.includes('appendPluginRecord'))
check('host 监听 step/start', host.includes("'step/start'"))

let failed = 0
for (const [name, ok] of checks) {
  if (!ok) failed += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}`)
}
console.log(`\n共 ${checks.length} 项，失败 ${failed} 项`)


