/**
 * 投屏会话：推 scrcpy.jar、起设备端 server、adb forward、等待 abstract socket。
 * 改编自 AYA (https://github.com/liriliri/aya) 的投屏实现，按其 AGPL-3.0 许可发布。
 */
import childProcess from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import { app } from 'electron'
import log from 'share/common/log'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import { getAdbPath, spawnAdb } from './adb'
import { IpcInstallWebCastApk, IpcReverseWebCast, IpcStartWebCast, IpcStopWebCast, IpcWaitWebCast, IpcWebCastDisplays } from 'common/types'

const logger = log('webCast')

// 方案 B：scrcpy-server 3.1 + @yume-chan/scrcpy 客户端
// 走 adb forward，把设备上的 localabstract:scrcpy_<scid> 映射到本机端口
const procs = new Map<string, childProcess.ChildProcess>()
const forwardPorts = new Map<string, number>()

const JAR_DIR = '/data/local/tmp/scrcpy-webcast'
const SERVER_VERSION = '3.1'
// 只清理本程序推上去的 server，避免误杀用户自己开的 scrcpy
const KILL_CMD = `pkill -f ${JAR_DIR}/scrcpy-`

// 同一台设备的启动/停止/换源必须串行，否则两个会话会互相删对方的 forward 和进程
const locks = new Map<string, Promise<any>>()

function withLock<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(deviceId) || Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  locks.set(deviceId, tail)
  tail.then(() => {
    if (locks.get(deviceId) === tail) locks.delete(deviceId)
  })
  return run
}

// 参数会拼进设备的 shell 命令行：只允许 k=v 形式的白名单字符
function buildServerCmd(jarRemote: string, args: string[]) {
  const safe = args.map((arg) => {
    if (!/^[A-Za-z0-9_]+=[A-Za-z0-9_.,:+-]*$/.test(arg)) {
      throw new Error('非法的投屏参数: ' + arg)
    }
    return arg
  })
  return `CLASSPATH=${jarRemote} app_process /system/bin com.genymobile.scrcpy.Server ${SERVER_VERSION} ${safe.join(
    ' '
  )}`
}

async function killSession(deviceId: string) {
  const cp = procs.get(deviceId)
  if (cp) {
    procs.delete(deviceId)
    try {
      cp.kill()
    } catch {
      // ignore
    }
  }
  const port = forwardPorts.get(deviceId)
  if (port) {
    forwardPorts.delete(deviceId)
    await spawnAdb(
      ['-s', deviceId, 'forward', '--remove', `tcp:${port}`],
      8000
    ).catch(() => undefined)
  }
  // 只 kill adb 客户端不会结束设备端的 app_process：残留 server 会占着 abstract socket，
  // 重连时可能连到旧会话（参数看起来“没生效”），也会一直编码耗电
  await spawnAdb(['-s', deviceId, 'shell', KILL_CMD], 8000).catch(
    () => undefined
  )
}

export const startWebCast: IpcStartWebCast = async function (deviceId, args) {
  return withLock(deviceId, async () => {
    const jar = resolveResources('scrcpy.jar')
    if (!fs.existsSync(jar)) {
      return { ok: false, error: '缺少 resources/scrcpy.jar' }
    }
    // 每次用不同文件名：旧 server 退出时会删除自己的 jar，同名会被它顺手删掉导致新 server 起不来
    const jarRemote = `${JAR_DIR}/scrcpy-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}.jar`

    const old = procs.get(deviceId)
    if (old) {
      procs.delete(deviceId)
      try {
        old.kill()
      } catch {
        // ignore
      }
    }

    let cmd: string
    try {
      cmd = buildServerCmd(jarRemote, args)
    } catch (e: any) {
      return { ok: false, error: e.message }
    }

    await spawnAdb(['-s', deviceId, 'shell', `mkdir -p ${JAR_DIR}`], 15000)
    const push = await spawnAdb(
      ['-s', deviceId, 'push', jar, jarRemote],
      60000
    )
    if (push.code !== 0) {
      logger.error('push failed', push.stderr)
      return { ok: false, error: push.stderr || '推送 scrcpy.jar 失败' }
    }

    logger.info('start server', cmd)

    const cp = childProcess.spawn(
      getAdbPath(),
      ['-s', deviceId, 'shell', cmd],
      { env: { ...process.env }, windowsHide: true }
    )
    cp.stdout?.on('data', (d: Buffer) => {
      const text = String(d).trim()
      if (text) logger.info('[server]', text)
    })
    cp.stderr?.on('data', (d: Buffer) => {
      const text = String(d).trim()
      if (text) logger.error('[server]', text)
    })
    // spawn 失败（adb 被删/被杀毒软件锁）只会发 'error'，没有 exit：
    // 不处理就是主进程未捕获异常，procs 里还会永远留着一个死进程
    cp.on('error', (e) => {
      logger.error('adb shell spawn failed', e)
      if (procs.get(deviceId) === cp) procs.delete(deviceId)
    })
    cp.on('exit', (code) => {
      logger.info('server exit', code)
      if (procs.get(deviceId) === cp) procs.delete(deviceId)
    })

    procs.set(deviceId, cp)
    return { ok: true }
  })
}

export const stopWebCast: IpcStopWebCast = async function (deviceId) {
  return withLock(deviceId, () => killSession(deviceId))
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

// 走 adb forward（这台 Android 8.1 设备上 reverse 会报 more than one device/emulator）
export const reverseWebCast: IpcReverseWebCast = async function (
  deviceId,
  remote
) {
  return withLock(deviceId, async () => {
    const oldPort = forwardPorts.get(deviceId)
    if (oldPort) {
      await spawnAdb(
        ['-s', deviceId, 'forward', '--remove', `tcp:${oldPort}`],
        10000
      ).catch(() => undefined)
      forwardPorts.delete(deviceId)
    }
    // tcp:0 让 adb 自己挑空闲端口，省掉「先探测端口再 bind」之间被别的进程抢走的竞态
    let port = 0
    const auto = await spawnAdb(['-s', deviceId, 'forward', 'tcp:0', remote], 15000)
    const m = String(auto.stdout || '')
      .trim()
      .match(/^(\d+)$/)
    if (auto.code === 0 && m) {
      port = Number(m[1])
    } else {
      port = await getFreePort()
      const r = await spawnAdb(
        ['-s', deviceId, 'forward', `tcp:${port}`, remote],
        15000
      )
      if (r.code !== 0) {
        return {
          ok: false,
          port: 0,
          error: (r.stderr || r.stdout || 'adb forward 失败').trim(),
        }
      }
    }
    forwardPorts.set(deviceId, port)
    return { ok: true, port }
  })
}

export const installApk: IpcInstallWebCastApk = async function (
  deviceId,
  apkPath
) {
  const r = await spawnAdb(
    ['-s', deviceId, 'install', '-r', '-t', apkPath],
    180000
  )
  return {
    ok: r.code === 0,
    message: (r.stdout || r.stderr || '').trim(),
  }
}

// 用 scrcpy-server 的 list_displays=true 枚举信号源（短连接，不推流）
// 60 秒内复用：枚举要推 jar + 起 server，远程链路上每次 3~10 秒
const displayCache = new Map<
  string,
  { ts: number; list: { id: number; name: string }[] }
>()

export const listDisplays: IpcWebCastDisplays = async function (deviceId) {
  const hit = displayCache.get(deviceId)
  if (hit && Date.now() - hit.ts < 60000) return hit.list
  const jar = resolveResources('scrcpy.jar')
  if (!fs.existsSync(jar)) return [{ id: 0, name: '主屏' }]
  // 固定文件名，避免每点一次“信号源”就在设备 /data/local/tmp 里堆一个 jar
  const jarRemote = `${JAR_DIR}/scrcpy-list.jar`
  await spawnAdb(['-s', deviceId, 'shell', `mkdir -p ${JAR_DIR}`], 15000)
  const push = await spawnAdb(
    ['-s', deviceId, 'push', jar, jarRemote],
    60000
  )
  if (push.code !== 0) {
    logger.error('list displays push failed', push.stderr)
    return [{ id: 0, name: '主屏' }]
  }
  const cmd = `CLASSPATH=${jarRemote} app_process /system/bin com.genymobile.scrcpy.Server ${SERVER_VERSION} list_displays=true max_size=1280 audio=false control=false tunnel_forward=true`
  const r = await spawnAdb(['-s', deviceId, 'shell', cmd], 20000)
  const out = (r.stdout || '') + (r.stderr || '')
  const result: { id: number; name: string }[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/display[^\n]*?id=(\d+)/i)
    if (!m) continue
    const id = Number(m[1])
    if (result.some((x) => x.id === id)) continue
    const size = line.match(/(\d+)x(\d+)/)
    result.push({
      id,
      name: id === 0 ? '主屏' : `副屏 ${id}${size ? ` (${size[0]})` : ''}`,
    })
  }
  if (!result.length) result.push({ id: 0, name: '主屏' })
  if (displayCache.size > 32) {
    const oldest = displayCache.keys().next().value
    if (oldest !== undefined) displayCache.delete(oldest)
  }
  displayCache.set(deviceId, { ts: Date.now(), list: result })
  return result
}

// 轮询设备端 abstract socket，确认 scrcpy-server 已经开始监听
export const waitWebCast: IpcWaitWebCast = async function (deviceId, scid) {
  const name = `scrcpy_${scid.padStart(8, '0')}`
  for (let i = 0; i < 60; i++) {
    // 会话已经被停掉（换源/关窗口）就别再空跑 12 秒
    if (!procs.has(deviceId)) return { ok: false }
    const r = await spawnAdb(
      ['-s', deviceId, 'shell', `cat /proc/net/unix | grep -c ${name}`],
      8000
    )
    const count = (r.stdout || '').trim()
    if (r.code === 0 && count && count !== '0') return { ok: true }
    await new Promise((res) => setTimeout(res, 200))
  }
  return { ok: false }
}

// 退出时同步收尾：will-quit 的异步回调不会被等待，必须用 spawnSync
function cleanupAllSync() {
  const adb = getAdbPath()
  for (const [deviceId, cp] of procs) {
    try {
      cp.kill()
    } catch {
      // ignore
    }
    const port = forwardPorts.get(deviceId)
    if (port) {
      childProcess.spawnSync(
        adb,
        ['-s', deviceId, 'forward', '--remove', `tcp:${port}`],
        { timeout: 3000, windowsHide: true }
      )
    }
    childProcess.spawnSync(adb, ['-s', deviceId, 'shell', KILL_CMD], {
      timeout: 3000,
      windowsHide: true,
    })
  }
  procs.clear()
  forwardPorts.clear()
}

export function init() {
  handleEvent('reverseWebCast', reverseWebCast)
  handleEvent('startWebCast', startWebCast)
  handleEvent('stopWebCast', stopWebCast)
  handleEvent('installWebCastApk', installApk)
  handleEvent('waitWebCast', waitWebCast)
  handleEvent('getWebCastDisplays', listDisplays)
  app.on('will-quit', cleanupAllSync)
}
