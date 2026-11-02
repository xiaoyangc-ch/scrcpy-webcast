import childProcess from 'node:child_process'
import fs from 'node:fs'
import isWindows from 'licia/isWindows'
import { decodeAdbOutput } from 'common/adbParse'
import { resolveResources } from 'share/main/lib/util'
import { IDevice } from 'common/types'

export function getAdbPath() {
  return isWindows ? resolveResources('adb/adb.exe') : resolveResources('adb/adb')
}

/**
 * 直接 spawn 参数数组（shell:false）：不经过 cmd.exe，
 * 避免 % 变量展开和 & | ^ 等字符被解释，也少一层进程开销。
 */
export function spawnAdb(
  args: string[],
  timeoutMs = 60000
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const bin = getAdbPath()

  return new Promise((resolve, reject) => {
    const cp = childProcess.spawn(bin, args, {
      env: { ...process.env },
      windowsHide: true,
    })

    // 先收集原始字节，结束时整体解码：adb 输出是 UTF-8，cmd 的报错可能是 GBK，
    // 逐块解码会在多字节字符被切分时误判成 GBK，出现乱码。
    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    let done = false

    cp.stdout?.on('data', (data: Buffer) => outChunks.push(data))
    cp.stderr?.on('data', (data: Buffer) => errChunks.push(data))

    // 兜底超时：设备/隧道卡死时不能无限等待
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try {
        cp.kill()
      } catch {
        // ignore
      }
      resolve({
        stdout: decodeAdbOutput(outChunks),
        stderr: (decodeAdbOutput(errChunks) + '\n[timeout]').trim(),
        code: -1,
      })
    }, timeoutMs)

    cp.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })

    cp.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ stdout: decodeAdbOutput(outChunks), stderr: decodeAdbOutput(errChunks), code })
    })
  })
}

function parseState(state: string): IDevice['type'] {
  if (state === 'device') return 'device'
  if (state === 'offline') return 'offline'
  if (state === 'unauthorized') return 'unauthorized'
  return 'unknown'
}

export async function listDevices(): Promise<IDevice[]> {
  const bin = getAdbPath()
  if (!fs.existsSync(bin)) {
    throw new Error(`缺少 adb 可执行文件：${bin}`)
  }

  const r = await spawnAdb(['devices', '-l'], 15000)
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || 'adb devices 失败').trim())
  }

  const devices: IDevice[] = []
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) {
      continue
    }
    const [serial, state] = line.split(/\s+/)
    if (!serial || !state) continue
    const model = line.match(/model:(\S+)/)
    const type = parseState(state)
    if (type === 'device' && serial.startsWith('emulator-')) {
      devices.push({ id: serial, name: model ? model[1] : serial, type: 'emulator' })
      continue
    }
    devices.push({
      id: serial,
      name: model ? model[1].replace(/_/g, ' ') : serial,
      type,
    })
  }

  // 在线设备补一个系统版本，失败不影响列表
  await Promise.all(
    devices
      .filter((d) => d.type === 'device')
      .map(async (d) => {
        try {
          const v = await spawnAdb(
            ['-s', d.id, 'shell', 'getprop ro.build.version.release'],
            6000
          )
          d.androidVersion = (v.stdout || '').trim()
        } catch {
          // ignore
        }
      })
  )

  return devices
}

/** 设备当前输入法：投屏里切换中英文/输入中文时要按原输入法恢复 */
export async function getInputMethod(deviceId: string): Promise<string> {
  const r = await spawnAdb(
    ['-s', deviceId, 'shell', 'settings', 'get', 'secure', 'default_input_method'],
    8000
  )
  return (r.stdout || '').trim()
}

export async function rebootDevice(deviceId: string): Promise<void> {
  await spawnAdb(['-s', deviceId, 'reboot'], 8000)
}
