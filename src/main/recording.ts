import fs from 'node:fs'
import path from 'node:path'
import uniqId from 'licia/uniqId'
import { app } from 'electron'
import { getUserDataPath, handleEvent } from 'share/main/lib/util'
import log from 'share/common/log'
import {
  IpcRecordingChunk,
  IpcRecordingStart,
  IpcRecordingStop,
} from 'common/types'

const logger = log('recording')

// 录制分片直接写盘：之前整段 webm 堆在渲染进程内存里，
// 10 分钟 1080p 就是几百 MB，长时间录制必然卡死/崩溃
const sessions = new Map<string, { stream: fs.WriteStream; file: string }>()

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const start: IpcRecordingStart = async function (deviceId) {
  const dir = getUserDataPath('recordings')
  fs.mkdirSync(dir, { recursive: true })
  const safeId = String(deviceId).replace(/[^\w.-]+/g, '_')
  const file = path.join(dir, `${safeId}-${stamp()}.webm`)
  const stream = fs.createWriteStream(file)
  stream.on('error', (e) => logger.error('write failed', e))
  const id = uniqId('rec')
  sessions.set(id, { stream, file })
  logger.info('recording start', file)
  return { id, path: file }
}

const chunk: IpcRecordingChunk = async function (id, data) {
  const session = sessions.get(id)
  if (!session) return
  const buf = Buffer.from(data)
  // 磁盘写得慢就等 drain，别把视频堆回内存
  if (!session.stream.write(buf)) {
    await new Promise<void>((resolve) => session.stream.once('drain', resolve))
  }
}

const stop: IpcRecordingStop = async function (id) {
  const session = sessions.get(id)
  if (!session) return { path: '' }
  sessions.delete(id)
  await new Promise<void>((resolve) => session.stream.end(() => resolve()))
  logger.info('recording stop', session.file)
  return { path: session.file }
}

// 退出时把还在写的文件正常收尾（webm 末尾的 Duration 等在 trailer 里）
function closeAll() {
  for (const [, session] of sessions) {
    try {
      session.stream.end()
    } catch {
      // ignore
    }
  }
  sessions.clear()
}

export function init() {
  handleEvent('recordingStart', start)
  handleEvent('recordingChunk', chunk)
  handleEvent('recordingStop', stop)
  app.on('will-quit', closeAll)
}
