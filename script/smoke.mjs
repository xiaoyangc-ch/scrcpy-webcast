// 冒烟：启动 Electron，用 CDP 截图并收集 console 报错
// 用法：node script/smoke.mjs [--page webcast] [--out shot.png]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}

const port = Number(arg('port', 9334))
const out = arg('out', 'shot.png')
const page = arg('page', '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const electron = path.resolve('node_modules/electron/dist/electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  stdio: 'ignore',
})

async function waitForPage() {
  const started = Date.now()
  while (Date.now() - started < 30000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      // 端口还没起来
    }
    await sleep(300)
  }
  throw new Error('等不到调试端口')
}

const target = await waitForPage()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value || a.description).join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text)
  }
}

await new Promise((r) => (ws.onopen = r))
await send('Runtime.enable')
await send('Page.enable')
await sleep(1500)

if (page) {
  const query = arg('query', '')
  const qs = `page=${page}${query ? '&' + query : ''}`
  await send('Page.navigate', {
    url: `file://${path.resolve('dist/renderer/index.html')}?${qs}`,
  })
  await sleep(2500)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('screenshot:', path.resolve(out))
console.log('console errors:', errors.length ? errors : 'none')
ws.close()
child.kill()
process.exit(0)
