// 开发模式启动器：等 vite dev server 和主进程构建产物就绪后再拉起 Electron
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const PORT = 8080
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function portOpen(port) {
  // vite 在 Windows 上可能只监听 ::1，用 http 探活比 net.connect 到 127.0.0.1 稳
  return fetch(`http://localhost:${port}/`)
    .then((r) => r.ok)
    .catch(() => false)
}

const electronBin =
  process.platform === 'win32'
    ? path.resolve('node_modules/electron/dist/electron.exe')
    : path.resolve('node_modules/.bin/electron')

const started = Date.now()
while (Date.now() - started < 60000) {
  if (
    existsSync(path.resolve('dist/main/index.js')) &&
    (await portOpen(PORT))
  ) {
    break
  }
  await sleep(400)
}

const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: `http://localhost:${PORT}` },
})
child.on('exit', (code) => process.exit(code ?? 0))
