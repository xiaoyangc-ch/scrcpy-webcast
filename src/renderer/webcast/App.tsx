/**
 * 投屏窗口：WebCodecs 解码到 canvas，工具栏/触摸/按键/录制都在这一层。
 * 改编自 AYA (https://github.com/liriliri/aya) 的投屏实现，按其 AGPL-3.0 许可发布。
 */
import { useEffect, useRef, useState } from 'react'
import getUrlParam from 'licia/getUrlParam'
import download from 'licia/download'
import fullscreen from 'licia/fullscreen'
import dateFormat from 'licia/dateFormat'
import LunaModal from 'luna-modal'
import LunaToolbar, {
  LunaToolbarSeparator,
  LunaToolbarSpace,
} from 'luna-toolbar/react'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { LoadingBar } from 'share/renderer/components/loading'
import { t } from 'common/util'
import {
  AndroidKeyCode,
  ScrcpyOptions3_1,
  ScrcpyVideoCodecId,
} from '@yume-chan/scrcpy'
import {
  WebCodecsVideoDecoder,
  InsertableStreamVideoFrameRenderer,
} from '@yume-chan/scrcpy-decoder-webcodecs'
import { ReadableStream } from '@yume-chan/stream-extra'
import Style from './App.module.scss'

interface OpenStream {
  stream: ReadableStream<Uint8Array>
  id: number
  close: () => void
}

interface CastSettings {
  bitRate: number
  maxSize: number
  maxFps: number
  codec: 'h264' | 'h265'
  displayId?: number
}

const DEFAULT_SETTINGS: CastSettings = {
  bitRate: 8000000,
  maxSize: 1280,
  maxFps: 30,
  codec: 'h264',
  displayId: 0,
}

const KEY_MAP: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Tab: 61,
  Escape: 111,
  Delete: 112,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Insert: 124,
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,
}

function openStream(port: number, waitFirst = false): Promise<OpenStream | null> {
  return new Promise((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let streamId = 0
    let settled = false

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        if (streamId) node.closeStream(streamId)
      },
    })

    const finish = (result: OpenStream | null) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    streamId = node.connectStream(port, {
      onConnect: () => {
        if (!waitFirst) {
          finish({ stream, id: streamId, close: () => node.closeStream(streamId) })
        }
      },
      onData: (data: Uint8Array) => {
        try {
          controller?.enqueue(data)
        } catch {
          // ignore
        }
        if (waitFirst) {
          finish({ stream, id: streamId, close: () => node.closeStream(streamId) })
        }
      },
      onClose: () => {
        try {
          controller?.close()
        } catch {
          // ignore
        }
        if (!settled) finish(null)
      },
      onError: (message: string) => {
        if (!settled) {
          finish(null)
        } else {
          try {
            controller?.error(new Error(message))
          } catch {
            // ignore
          }
        }
      },
    })

    setTimeout(() => {
      if (!settled) {
        finish(null)
        node.closeStream(streamId)
      }
    }, 12000)
  })
}

function hasNonAscii(text: string) {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 127) return true
  }
  return false
}

function scidOf(deviceId: string) {
  let hash = 0
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash * 31 + deviceId.charCodeAt(i)) | 0
  }
  return String((Math.abs(hash) + Math.floor(Date.now() / 1000)) % 999999)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function stripLeadingZero(
  input: ReadableStream<Uint8Array>
): Promise<ReadableStream<Uint8Array>> {
  const reader = input.getReader()
  const first = await reader.read()
  let head = first.done ? null : first.value
  if (head && head.length && head[0] === 0) {
    head = head.slice(1)
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head) controller.enqueue(head)
      if (first.done) controller.close()
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(value)
    },
    cancel() {
      reader.cancel()
    },
  })
}

function injectKey(id: number, code: number, metaState = 0, repeat = 0) {
  injectKeyAction(id, code, 0, metaState, repeat)
  injectKeyAction(id, code, 1, metaState, repeat)
}

// 单动作按键（用于按住修饰键的场景：部分 App 只认真正的 Ctrl/Shift down/up，
// 只看 metaState 的注入会被忽略）
function injectKeyAction(
  id: number,
  code: number,
  action: number,
  metaState = 0,
  repeat = 0
) {
  const buf = new Uint8Array(14)
  const dv = new DataView(buf.buffer)
  buf[0] = 0
  buf[1] = action
  dv.setUint32(2, code)
  dv.setUint32(6, repeat)
  dv.setUint32(10, metaState)
  node.writeStream(id, buf)
}

function injectModifierCombo(
  id: number,
  modifier: number,
  code: number,
  metaState = 0
) {
  injectKeyAction(id, modifier, 0)
  setTimeout(() => {
    injectKeyAction(id, code, 0, metaState)
    injectKeyAction(id, code, 1, metaState)
    setTimeout(() => injectKeyAction(id, modifier, 1), 20)
  }, 20)
}

function injectText(id: number, text: string) {
  const bytes = new TextEncoder().encode(text)
  const buf = new Uint8Array(5 + bytes.length)
  const dv = new DataView(buf.buffer)
  buf[0] = 1
  dv.setUint32(1, bytes.length)
  buf.set(bytes, 5)
  node.writeStream(id, buf)
}

function injectTouch(
  id: number,
  action: number,
  x: number,
  y: number,
  width: number,
  height: number,
  pointerId = -1
) {
  const buf = new Uint8Array(32)
  const dv = new DataView(buf.buffer)
  buf[0] = 2
  buf[1] = action
  dv.setBigInt64(2, BigInt(pointerId))
  dv.setInt32(10, x)
  dv.setInt32(14, y)
  dv.setUint16(18, width)
  dv.setUint16(20, height)
  dv.setUint16(22, action === 1 ? 0 : 65535)
  dv.setUint32(24, 0)
  dv.setUint32(28, 0)
  node.writeStream(id, buf)
}

// 读控制通道的设备消息：目前处理剪贴板（type 0）与 ACK（type 1）
async function readDeviceMessages(
  stream: ReadableStream<Uint8Array>,
  onClipboard: (text: string) => void
) {
  const reader = stream.getReader()
  let buf = new Uint8Array(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value && value.length) {
        const next = new Uint8Array(buf.length + value.length)
        next.set(buf, 0)
        next.set(value, buf.length)
        buf = next
      }
      for (;;) {
        if (!buf.length) break
        const type = buf[0]
        if (type === 0) {
          // 设备端 CLIPBOARD 消息：type(1) + 长度 u32（大端）+ 文本，
          // 没有 sequence —— 原来按 8 字节 sequence 解析会读出垃圾长度并让循环卡死
          if (buf.length < 5) break
          const dv = new DataView(buf.buffer, buf.byteOffset)
          const len = dv.getUint32(1)
          if (buf.length < 5 + len) break
          const text = new TextDecoder().decode(buf.subarray(5, 5 + len))
          buf = buf.slice(5 + len)
          onClipboard(text)
          continue
        }
        if (type === 1) {
          if (buf.length < 9) break
          buf = buf.slice(9)
          continue
        }
        return
      }
    }
  } catch {
    // ignore
  }
}

// scrcpy 的 INJECT_TEXT 只支持 ASCII；中文等直接走剪贴板 + 粘贴
// 开启 clipboardAutosync 后设备会把同一段文本回传，这里记下最近一次发送，避免
// 自己粘贴自己时又弹「已同步设备剪贴板」并把 PC 剪贴板重复覆盖
let lastSentClip = { text: '', ts: 0 }

function injectClipboard(id: number, text: string) {
  lastSentClip = { text, ts: Date.now() }
  const bytes = new TextEncoder().encode(text)
  const buf = new Uint8Array(1 + 8 + 1 + 4 + bytes.length)
  const dv = new DataView(buf.buffer)
  buf[0] = 9
  dv.setBigUint64(1, BigInt(Date.now()))
  buf[9] = 1
  dv.setUint32(10, bytes.length)
  buf.set(bytes, 14)
  node.writeStream(id, buf)
}

function setScreenPower(id: number, mode: number) {
  node.writeStream(id, new Uint8Array([10, mode]))
}

function sendCommand(id: number, command: number) {
  node.writeStream(id, new Uint8Array([command]))
}

// scrcpy INJECT_SCROLL：x/y/w/h + signed 16bit 定点滚动量 + buttons
function injectScroll(
  id: number,
  x: number,
  y: number,
  width: number,
  height: number,
  scrollX: number,
  scrollY: number
) {
  const buf = new Uint8Array(21)
  const dv = new DataView(buf.buffer)
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const fixed = (v: number) => {
    const c = clamp(v)
    return c === 1 ? 0x7fff : Math.round(c * 0x8000)
  }
  buf[0] = 3
  dv.setUint32(1, x)
  dv.setUint32(5, y)
  dv.setUint16(9, width)
  dv.setUint16(11, height)
  dv.setInt16(13, fixed(scrollX))
  dv.setInt16(15, fixed(scrollY))
  dv.setUint32(17, 0)
  node.writeStream(id, buf)
}

export default function App() {
  const deviceId = getUrlParam('device') || ''
  const deviceName = getUrlParam('name') || deviceId
  const screenRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const ctlIdRef = useRef(0)
  // 控制通道还没建好时按下的 Ctrl+V：先存着，连上后自动粘贴（否则要按两次）
  const pendingPasteRef = useRef('')
  const sizeRef = useRef({ width: 0, height: 0 })
  const settingsRef = useRef<CastSettings>(DEFAULT_SETTINGS)
  // 设备不支持 HEVC 硬件编码时只自动回退一次，避免用户在设置里故意选 H.265 时被无声改掉
  const h265FallbackRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pin, setPin] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const imeRef = useRef('')
  const [settings, setSettings] = useState<CastSettings>(DEFAULT_SETTINGS)
  const [gen, setGen] = useState(0)
  const [displaysOpen, setDisplaysOpen] = useState(false)
  const [displays, setDisplays] = useState<{ id: number; name: string }[]>([])
  const [toast, setToast] = useState('')
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const retryRef = useRef(0)
  const oldVideosRef = useRef<HTMLVideoElement[]>([])
  const startedAtRef = useRef(0)
  // 录制时把画布每帧画到 video：重连后要能取到新的 video 元素
  const rafRef = useRef(0)
  const recordingStartingRef = useRef(false)
  // 解码器持有 rAF 循环和一个 VideoFrame 克隆，不 dispose 每次重连都会漏一个
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null)
  const reconnectTimerRef = useRef<any>(null)
  const loadingTimerRef = useRef<any>(null)

  useEffect(() => {
    // 左上角标题带上设备地址：远程设备是 ip:port，USB 设备没有 IP 就只显示名称
    const address = deviceId.includes(':') ? deviceId : ''
    preload.setTitle(address ? `${deviceName} (${address})` : deviceName)
  }, [deviceName, deviceId])

  useEffect(() => {
    main
      .getInputMethod(deviceId)
      .then((ime) => {
        imeRef.current = ime
      })
      .catch(() => {})
  }, [deviceId])

  // 关投屏窗口时 React 不一定会走 unmount（窗口先被销毁），
  // 这里兜一层 beforeunload，确保 adb shell / 设备端 server 被停掉
  useEffect(() => {
    const stop = () => {
      main.stopWebCast(deviceId).catch(() => {})
    }
    window.addEventListener('beforeunload', stop)
    return () => {
      window.removeEventListener('beforeunload', stop)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      try {
        recorderRef.current?.stop()
      } catch {
        // ignore
      }
      recorderRef.current = null
    }
  }, [deviceId])

  useEffect(() => {
    main
      .getScreencastStore('cast')
      .then((val: CastSettings | null) => {
        if (val && val.bitRate) {
          settingsRef.current = val
          setSettings(val)
        }
      })
      .catch(() => {
        // 读设置失败就用默认值，别产生未处理拒绝
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    let videoStream: OpenStream | null = null
    let controlStream: OpenStream | null = null

    async function start() {
      // 设置是异步读出来的，开局直接用 DEFAULT 会「设置里写着 16M，实际跑 8M」
      let cfg = settingsRef.current
      try {
        const stored = (await main.getScreencastStore(
          'cast'
        )) as CastSettings | null
        if (stored && stored.bitRate) {
          cfg = { ...DEFAULT_SETTINGS, ...stored }
          settingsRef.current = cfg
          setSettings(cfg)
        }
      } catch {
        // ignore
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      // 旧解码器必须在这里就关掉：本次启动失败也不能留下两个解码器
      decoderRef.current?.dispose()
      decoderRef.current = null
      startedAtRef.current = Date.now()
      // 先确保上一路 server/forward 已停止，避免它在新会话启动后再执行清理
      try {
        await main.stopWebCast(deviceId)
      } catch {
        // ignore
      }
      // 只移除我们手动 append 的 video，不能动 React 自己渲染的节点
      for (const v of oldVideosRef.current) v.remove()
      oldVideosRef.current = []
      setLoading(true)
      setError('')
      ctlIdRef.current = 0

      const options = new ScrcpyOptions3_1({
        audio: false,
        control: true,
        maxSize: cfg.maxSize,
        videoBitRate: cfg.bitRate,
        maxFps: cfg.maxFps,
        videoCodec: cfg.codec,
        displayId: cfg.displayId || 0,
        // 打开自动同步：设备端 Ctrl+C / 长按复制后，剪贴板会回传到 PC
        clipboardAutosync: true,
        stayAwake: true,
        tunnelForward: true,
      })
      const scid = scidOf(deviceId)
      options.value.scid = scid

      const rev = await main.reverseWebCast(
        deviceId,
        `localabstract:scrcpy_${scid.padStart(8, '0')}`
      )
      if (!rev.ok) throw new Error(rev.error || 'adb forward 失败')
      if (cancelled) return

      const r = await main.startWebCast(deviceId, options.serialize())
      if (!r.ok) throw new Error(r.error || '启动失败')

      // 等设备端监听就绪（轮询 abstract socket），再连接，避免盲等/重试
      const ready = await main.waitWebCast(deviceId, scid)
      if (!ready.ok) throw new Error('设备端服务启动超时')
      let stream: OpenStream | null = null
      for (let i = 0; i < 3 && !cancelled; i++) {
        stream = await openStream(rev.port, true)
        if (stream) break
        await sleep(300)
      }
      if (!stream) throw new Error('连接 scrcpy 服务失败')
      if (cancelled) {
        stream.close()
        return
      }
      videoStream = stream

      for (let i = 0; i < 5 && !cancelled; i++) {
        const cs = await openStream(rev.port)
        if (cs) {
          controlStream = cs
          ctlIdRef.current = cs.id
          if (pendingPasteRef.current) {
            const text = pendingPasteRef.current
            pendingPasteRef.current = ''
            injectClipboard(cs.id, text)
          }
          readDeviceMessages(cs.stream, (text) => {
            if (text === lastSentClip.text && Date.now() - lastSentClip.ts < 3000) {
              return
            }
            main.writeClipboard(text).catch(() => undefined)
            setToast('已同步设备剪贴板')
            setTimeout(() => setToast(''), 2000)
          })
          break
        }
        await sleep(300)
      }

      const fixed = await stripLeadingZero(stream.stream)
      const { stream: video, metadata } =
        await options.parseVideoStreamMetadata(fixed)
      if (
        metadata.codec !== ScrcpyVideoCodecId.H264 &&
        metadata.codec !== ScrcpyVideoCodecId.H265
      ) {
        throw new Error(`不支持的编码：${metadata.codec}`)
      }
      sizeRef.current = {
        width: metadata.width || 1280,
        height: metadata.height || 720,
      }
      if (metadata.width && metadata.height) {
        main.resizeWebCast(deviceId, metadata.width, metadata.height)
      }

      const renderer = new InsertableStreamVideoFrameRenderer()
      const decoder = new WebCodecsVideoDecoder({
        codec: metadata.codec,
        renderer,
      })
      decoderRef.current = decoder
      const el = renderer.element as HTMLVideoElement
      el.className = Style.video
      el.tabIndex = 0
      videoRef.current = el
      oldVideosRef.current.push(el)
      screenRef.current?.appendChild(el)
      bindPointer(el)

      video
        .pipeThrough(options.createMediaStreamTransformer())
        .pipeTo(decoder.writable)
        .then(() => {
          if (!cancelled) handleDrop()
        })
        .catch((e: Error) => {
          if (!cancelled) handleDrop(e)
        })

      // 等到第一帧真正解码出来再撤 loading：之前是 pipeTo 一开始就撤，
      // 用户看到的是一块黑屏；副屏没信号时更是永远黑屏且没有任何提示
      const markReady = () => {
        if (cancelled) return
        retryRef.current = 0
        setLoading(false)
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current)
          loadingTimerRef.current = null
        }
      }
      const elAny = el as any
      if (typeof elAny.requestVideoFrameCallback === 'function') {
        elAny.requestVideoFrameCallback(markReady)
      } else {
        el.addEventListener('loadeddata', markReady, { once: true })
      }
      loadingTimerRef.current = setTimeout(() => {
        if (cancelled) return
        setLoading(false)
        setToast('该信号源暂无画面输出')
      }, 8000)
    }

    function handleDrop(e?: Error) {
      if (cancelled) return
      // 注意：以前这里有个只置 true 从不复位的 intentionalRef，
      // 第一次切信号源/保存设置之后所有断线都会被它吞掉（画面卡住不动、也不重连）
      if (reconnectTimerRef.current) return
      if (retryRef.current < 2) {
        retryRef.current += 1
        const quiet = Date.now() - startedAtRef.current < 10000
        if (!quiet) {
          setToast(`连接断开，正在第 ${retryRef.current} 次重连…`)
          setTimeout(() => setToast(''), 3000)
        }
        setLoading(true)
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          setGen((g) => g + 1)
        }, 1200)
      } else {
        setLoading(false)
        setError(e ? String(e.message || e) : '连接已断开')
      }
    }

    function toDevicePoint(e: PointerEvent) {
      const el = videoRef.current
      if (!el) return null
      let { width, height } = sizeRef.current
      if (el.videoWidth && el.videoHeight) {
        width = el.videoWidth
        height = el.videoHeight
        sizeRef.current = { width, height }
      }
      if (!width || !height) return null
      const rect = el.getBoundingClientRect()
      const scale = Math.min(rect.width / width, rect.height / height)
      const dw = width * scale
      const dh = height * scale
      const left = rect.left + (rect.width - dw) / 2
      const top = rect.top + (rect.height - dh) / 2
      const x = Math.round((e.clientX - left) / scale)
      const y = Math.round((e.clientY - top) / scale)
      return {
        x: Math.max(0, Math.min(width - 1, x)),
        y: Math.max(0, Math.min(height - 1, y)),
        width,
        height,
      }
    }

    // 多指触控：第一指 Down/Move/Up，第二指起用 PointerDown/PointerUp，可做双指缩放
    const activePointers = new Map<number, number>()
    const lastPoints = new Map<number, { x: number; y: number; width: number; height: number }>()
    function allocatePointerId() {
      // Android 只接受 0..31 的 pointer id；从 1 开始找空闲的（0 留给“主指/mouse”）
      const used = new Set(activePointers.values())
      for (let id = 1; id < 31; id++) {
        if (!used.has(id)) return id
      }
      return 1
    }
    function bindPointer(el: HTMLVideoElement) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        el.focus()
        if (e.button === 2) {
          if (ctlIdRef.current) injectKey(ctlIdRef.current, AndroidKeyCode.AndroidBack)
          return
        }
        if (e.button === 1) {
          if (ctlIdRef.current) injectKey(ctlIdRef.current, AndroidKeyCode.AndroidHome)
          return
        }
        if (e.button !== 0) return
        el.setPointerCapture?.(e.pointerId)
        const p = toDevicePoint(e)
        if (!p || !ctlIdRef.current) return
        const first = activePointers.size === 0
        const pid = first ? 0 : allocatePointerId()
        activePointers.set(e.pointerId, pid)
        lastPoints.set(e.pointerId, p)
        injectTouch(
          ctlIdRef.current,
          first ? 0 : 5,
          p.x,
          p.y,
          p.width,
          p.height,
          first ? -1 : pid
        )
      })
      el.addEventListener('pointermove', (e) => {
        if (!activePointers.has(e.pointerId)) return
        const p = toDevicePoint(e)
        if (!p || !ctlIdRef.current) return
        lastPoints.set(e.pointerId, p)
        const pid = activePointers.get(e.pointerId)!
        injectTouch(ctlIdRef.current, 2, p.x, p.y, p.width, p.height, pid === 0 ? -1 : pid)
      })
      const release = (e: PointerEvent) => {
        if (!activePointers.has(e.pointerId)) return
        const pid = activePointers.get(e.pointerId)!
        // 手指抬起时可能已经移出画面：退回最后一次有效坐标，否则会漏发 UP 留下“卡住的手势”
        const p = toDevicePoint(e) || lastPoints.get(e.pointerId)
        activePointers.delete(e.pointerId)
        lastPoints.delete(e.pointerId)
        if (!p || !ctlIdRef.current) return
        // 还有别的手指按着就发 POINTER_UP(6)，最后一个才发 UP(1)：
        // 先抬主指时发 UP 会让 Android 直接结束整个手势，剩下的手指就“死”了
        const action = activePointers.size === 0 ? 1 : 6
        injectTouch(
          ctlIdRef.current,
          action,
          p.x,
          p.y,
          p.width,
          p.height,
          pid === 0 ? -1 : pid
        )
      }
      el.addEventListener('pointerup', release)
      el.addEventListener('pointercancel', release)
      el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault()
          const p = toDevicePoint(e as unknown as PointerEvent)
          if (p && ctlIdRef.current) {
            injectScroll(
              ctlIdRef.current,
              p.x,
              p.y,
              p.width,
              p.height,
              -e.deltaX / 100,
              -e.deltaY / 100
            )
          }
        },
        { passive: false }
      )
    }

    // 物理键盘：单字符走 INJECT_TEXT，功能键走 INJECT_KEYCODE
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const id = ctlIdRef.current
      if (!id) return

      // scrcpy 风格快捷键
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase()
        e.preventDefault()
        switch (k) {
          case 'h':
            injectKey(id, AndroidKeyCode.AndroidHome)
            return
          case 'b':
            injectKey(id, AndroidKeyCode.AndroidBack)
            return
          case 's':
            injectKey(id, AndroidKeyCode.AndroidAppSwitch)
            return
          case 'm':
            injectKey(id, AndroidKeyCode.ContextMenu)
            return
          case 'p':
            injectKey(id, AndroidKeyCode.Power)
            return
          case 'o':
            setScreenPower(id, e.shiftKey ? 2 : 0)
            return
          case 'r':
            sendCommand(id, 11)
            return
          case 'n':
            sendCommand(id, e.shiftKey ? 7 : 5)
            return
          case 'v': {
            // 直接粘贴 PC 剪贴板：SET_CLIPBOARD 带 paste 标志，设备端会自动粘贴。
            // 读剪贴板走主进程（Electron clipboard 同步读取），比 navigator.clipboard 稳定且快
            main
              .readClipboard()
              .then((text) => {
                if (!text) {
                  setToast('剪贴板为空')
                  setTimeout(() => setToast(''), 2000)
                  return
                }
                if (!ctlIdRef.current) {
                  // 刚打开/刚重连，控制通道还没就绪：排队，连上后自动粘贴
                  pendingPasteRef.current = text
                  setToast('连接中，稍后自动粘贴')
                  setTimeout(() => setToast(''), 2000)
                  return
                }
                injectClipboard(ctlIdRef.current, text)
              })
              .catch(() => {
                setToast('读取剪贴板失败')
                setTimeout(() => setToast(''), 2000)
              })
            return
          }
          case 'c':
            // 设备端复制：复制完成后由剪贴板同步把内容带回 PC
            injectKey(id, AndroidKeyCode.AndroidCopy)
            return
          case 'x':
            injectKey(id, AndroidKeyCode.AndroidCut)
            return
          case 'a': {
            // 和 scrcpy 一样：Ctrl+A 原样转发给设备，不做输入法判断/切换
            injectModifierCombo(
              id,
              AndroidKeyCode.ControlLeft,
              AndroidKeyCode.KeyA,
              0x1000
            )
            return
          }
          default:
            return
        }
      }
      if (e.metaKey || e.altKey) return

      const code = KEY_MAP[e.key]
      if (code) {
        e.preventDefault()
        injectKey(id, code, e.shiftKey ? 1 : 0, e.repeat ? 1 : 0)
        return
      }
      // 输入法/键盘布局会把 Shift、CapsLock 的小写字母报成 e.key='a'，
      // 直接发 'a' 就永远是大写失效；这里用 e.code 兜底，并按 Shift XOR CapsLock 还原大小写
      let ch = e.key
      const codeLetter = /^Key([A-Z])$/.exec(e.code)
      if (codeLetter && (ch.length !== 1 || /^[a-z]$/i.test(ch))) {
        ch = codeLetter[1]
      }
      if (/^[a-z]$/i.test(ch)) {
        const caps = e.getModifierState('CapsLock')
        ch = e.shiftKey !== caps ? ch.toUpperCase() : ch.toLowerCase()
      }
      if (ch.length === 1) {
        e.preventDefault()
        // 非 ASCII 或中文输入法下的大写：走剪贴板粘贴，绕开输入法
        const usePaste =
          hasNonAscii(ch) ||
          (/^[A-Z]$/.test(ch) &&
            imeRef.current !== '' &&
            !imeRef.current.includes('latin'))
        if (usePaste) {
          injectClipboard(id, ch)
        } else {
          injectText(id, ch)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)

    start().catch((e: any) => {
      if (cancelled) return
      setLoading(false)
      const msg = String(e && e.message ? e.message : e)
      // rk3399 这类设备没有可用的 HEVC 编码器，scrcpy server 会打印
      // "Could not create default video encoder for h265" 后立刻退出，
      // 前端只能看到流提前结束（ExactReadable ended）。这里自动回退一次 H.264，
      // 否则用户点「重新连接」会一直用 H.265 死循环。
      if (settingsRef.current.codec === 'h265' && !h265FallbackRef.current) {
        h265FallbackRef.current = true
        applySettings({ ...settingsRef.current, codec: 'h264' })
        setToast('该设备不支持 H.265 编码，已自动切回 H.264')
        setTimeout(() => setToast(''), 4000)
        setGen((g) => g + 1)
        return
      }
      if (/ExactReadable ended/i.test(msg)) {
        setError(
          settingsRef.current.codec === 'h265'
            ? '投屏流意外中断：该设备不支持 H.265 硬件编码，请改用 H.264'
            : '投屏流意外中断：设备端编码器异常（可点下方「重新连接」）'
        )
        return
      }
      setError(msg)
    })

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current)
        loadingTimerRef.current = null
      }
      document.removeEventListener('keydown', onKeyDown)
      decoderRef.current?.dispose()
      decoderRef.current = null
      for (const v of oldVideosRef.current) v.remove()
      oldVideosRef.current = []
      try {
        videoStream?.close()
        controlStream?.close()
      } catch {
        // ignore
      }
      main.stopWebCast(deviceId).catch(() => {})
    }
  }, [deviceId, gen])

  function inputKey(code: number) {
    return () => {
      if (ctlIdRef.current) injectKey(ctlIdRef.current, code)
    }
  }

  async function injectTextInput() {
    const text = await LunaModal.prompt(t('inputText'), '')
    if (!text || !ctlIdRef.current) return
    if (hasNonAscii(text)) {
      injectClipboard(ctlIdRef.current, text)
      setToast('已通过剪贴板粘贴（含非 ASCII 字符）')
      setTimeout(() => setToast(''), 2500)
    } else {
      injectText(ctlIdRef.current, text)
    }
  }

  function toggleFullscreen() {
    const el = screenRef.current
    if (el) fullscreen.toggle(el)
  }

  function startRecording() {
    if (recorderRef.current || recordingStartingRef.current) return
    const el = videoRef.current
    if (!el) return
    const canvas = document.createElement('canvas')
    canvas.width = el.videoWidth || 1280
    canvas.height = el.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let stopped = false
    const draw = () => {
      if (stopped) return
      // 重连/换源后 video 元素会被替换，这里每帧重新取，别录死在旧画面上
      const cur = videoRef.current
      if (cur && cur.videoWidth) {
        ctx.drawImage(cur, 0, 0, canvas.width, canvas.height)
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
    const stream = canvas.captureStream(30)
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    let recId = ''
    // 分片必须按序落盘，且 stop 前要等它们全部写完：
    // 原来 ondataavailable 里 fire-and-forget 调 IPC，最后一包可能在
    // recordingStop 删掉 session 之后才到 → webm 缺尾部（Duration/Cues）
    let writeChain: Promise<any> = Promise.resolve()
    rec.ondataavailable = (e) => {
      if (!e.data.size || !recId) return
      const id = recId
      writeChain = writeChain
        .then(() => e.data.arrayBuffer())
        .then((buf) => main.recordingChunk(id, new Uint8Array(buf)))
        .catch(() => undefined)
    }
    rec.onstop = async () => {
      stopped = true
      if (recorderRef.current === rec) recorderRef.current = null
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      try {
        await writeChain
      } catch {
        // ignore
      }
      let saved = ''
      try {
        const r = await main.recordingStop(recId)
        saved = r.path
      } catch {
        // ignore
      }
      setRecording(false)
      setToast(saved ? `录制已保存：${saved}` : '录制已停止')
      setTimeout(() => setToast(''), 5000)
    }
    ;(async () => {
      recordingStartingRef.current = true
      try {
        const r = await main.recordingStart(deviceId)
        recId = r.id
        rec.start(1000)
        recorderRef.current = rec
        setRecording(true)
        setToast('开始录制')
        setTimeout(() => setToast(''), 2000)
      } catch {
        stopped = true
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        // recordingStart 成功后 rec.start 抛错：主进程那边已经建了 fd，必须收掉
        if (recId) main.recordingStop(recId).catch(() => undefined)
        setRecording(false)
        setToast('录制启动失败')
        setTimeout(() => setToast(''), 3000)
      } finally {
        recordingStartingRef.current = false
      }
    })()
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  function captureScreenshot() {
    const el = videoRef.current
    if (!el) return
    const canvas = document.createElement('canvas')
    canvas.width = el.videoWidth || el.clientWidth
    canvas.height = el.videoHeight || el.clientHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (blob) {
        download(blob, `screenshot-${dateFormat('yyyymmddHHMM')}.png`, 'image/png')
      }
    }, 'image/png')
  }

  async function onDropFiles(e: React.DragEvent) {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files || [])
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.apk')) continue
      const path = preload.getPathForFile(file)
      if (!path) continue
      setToast(`正在安装 ${file.name}…`)
      const r = await main.installWebCastApk(deviceId, path)
      setToast(r.ok ? `${file.name} 安装完成` : `安装失败：${r.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }

  async function openDisplays() {
    setDisplaysOpen(true)
    try {
      const list = await main.getWebCastDisplays(deviceId)
      setDisplays(list)
    } catch {
      setToast('读取信号源失败')
      setTimeout(() => setToast(''), 3000)
    }
  }

  function restartSession() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    retryRef.current = 0
    setError('')
    setLoading(true)
    setGen((g) => g + 1)
  }

  function applySettings(next: CastSettings) {
    settingsRef.current = next
    setSettings(next)
    main.setScreencastStore('cast', next)
  }

  function chooseDisplay(id: number) {
    applySettings({ ...settingsRef.current, displayId: id })
    setDisplaysOpen(false)
    restartSession()
  }

  function saveSettings(next: CastSettings) {
    // 用户重新选择 H.265 时再给一次机会（可能换了设备/换了分辨率）
    if (next.codec === 'h265') h265FallbackRef.current = false
    applySettings(next)
    setSettingsOpen(false)
    restartSession()
  }

  return (
    <div
      className={Style.container}
      onDrop={onDropFiles}
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <LunaToolbar className={Style.toolbar}>
        <ToolbarIcon
          icon="power"
          title={t('power')}
          onClick={inputKey(AndroidKeyCode.Power)}
        />
        <ToolbarIcon
          icon="volume"
          title={t('volumeUp')}
          onClick={inputKey(AndroidKeyCode.VolumeUp)}
        />
        <ToolbarIcon
          icon="volume-down"
          title={t('volumeDown')}
          onClick={inputKey(AndroidKeyCode.VolumeDown)}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="back"
          title={t('back')}
          onClick={inputKey(AndroidKeyCode.AndroidBack)}
        />
        <ToolbarIcon
          icon="circle"
          title={t('home')}
          onClick={inputKey(AndroidKeyCode.AndroidHome)}
        />
        <ToolbarIcon
          icon="square"
          title={t('appSwitch')}
          onClick={inputKey(AndroidKeyCode.AndroidAppSwitch)}
        />
        <ToolbarIcon icon="text" title={t('inputText')} onClick={injectTextInput} />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="grid"
          title="信号源"
          onClick={openDisplays}
        />
        <ToolbarIcon
          icon="refresh"
          title="重启投屏"
          onClick={restartSession}
        />
        <ToolbarIcon
          icon="screen-off"
          title={t('screenOff')}
          onClick={() => {
            if (ctlIdRef.current) setScreenPower(ctlIdRef.current, 0)
          }}
        />
        <ToolbarIcon
          icon="screen-on"
          title={t('screenOn')}
          onClick={() => {
            if (ctlIdRef.current) setScreenPower(ctlIdRef.current, 2)
          }}
        />
        <ToolbarIcon
          icon="rotate-left"
          title="旋转屏幕"
          onClick={() => {
            if (ctlIdRef.current) sendCommand(ctlIdRef.current, 11)
          }}
        />
        <ToolbarIcon
          icon="expand"
          title="通知面板"
          onClick={() => {
            if (ctlIdRef.current) sendCommand(ctlIdRef.current, 5)
          }}
        />
        <ToolbarIcon
          icon="collapse"
          title="收起面板"
          onClick={() => {
            if (ctlIdRef.current) sendCommand(ctlIdRef.current, 7)
          }}
        />
        <ToolbarIcon icon="camera" title={t('screenshot')} onClick={captureScreenshot} />
        <ToolbarIcon
          icon="video-recorder"
          title={recording ? '停止录制' : '开始录制'}
          state={recording ? 'hover' : ''}
          onClick={() => (recording ? stopRecording() : startRecording())}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="pin"
          title={t('alwaysOnTop')}
          state={pin ? 'hover' : ''}
          onClick={() => {
            const next = !pin
            setPin(next)
            main.webCastOnTop(deviceId, next)
          }}
        />
        <ToolbarIcon icon="fullscreen" title={t('fullscreen')} onClick={toggleFullscreen} />
        <LunaToolbarSpace />
        <ToolbarIcon
          icon="setting"
          title={t('settings')}
          onClick={() => setSettingsOpen(true)}
        />
      </LunaToolbar>

      <div ref={screenRef} className={Style.screen}>
        {loading && (
          <div className={Style.loading}>
            <LoadingBar />
          </div>
        )}
        {error && (
          <div className={Style.errorBox}>
            <div className={Style.errorText}>{error}</div>
            <button className={Style.retry} onClick={restartSession}>
              重新连接
            </button>
          </div>
        )}
      </div>

      {toast && <div className={Style.toast}>{toast}</div>}

      {displaysOpen && (
        <div className={Style.mask} onClick={() => setDisplaysOpen(false)}>
          <div className={Style.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={Style.dialogTitle}>信号源</div>
            <div className={Style.hint}>
              副屏（HDMI）只有在设备端有内容输出时才有画面，否则是黑屏；可随时切回主屏。
            </div>
            {displays.map((d) => {
              const current = settings.displayId === d.id
              return (
                <button
                  key={d.id}
                  className={Style.displayItem}
                  disabled={current}
                  onClick={() => chooseDisplay(d.id)}
                >
                  {d.name}
                  {current ? '（当前）' : ''}
                </button>
              )
            })}
            <div className={Style.dialogBtns}>
              <button onClick={() => setDisplaysOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          value={settings}
          onCancel={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onReboot={() => {
            // 老版投屏工具栏上的「重启设备」入口；放到设置里，避免误点重启设备
            if (!window.confirm(`确定要重启「${deviceName}」吗？重启期间投屏会中断。`)) {
              return
            }
            setSettingsOpen(false)
            main
              .rebootDevice(deviceId)
              .then(() => {
                setToast('已发送重启命令')
                setTimeout(() => setToast(''), 3000)
              })
              .catch(() => {
                setToast('重启失败：设备可能已离线')
                setTimeout(() => setToast(''), 3000)
              })
          }}
        />
      )}
    </div>
  )
}

function SettingsDialog(props: {
  value: CastSettings
  onCancel: () => void
  onSave: (v: CastSettings) => void
  onReboot: () => void
}) {
  const [draft, setDraft] = useState<CastSettings>(props.value)

  return (
    <div className={Style.mask} onClick={props.onCancel}>
      <div className={Style.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={Style.dialogTitle}>投屏设置</div>
        <label className={Style.field}>
          <span>码率</span>
          <select
            value={draft.bitRate}
            onChange={(e) =>
              setDraft({ ...draft, bitRate: Number(e.target.value) })
            }
          >
            {[4000000, 8000000, 12000000, 16000000, 24000000, 32000000, 50000000].map(
              (v) => (
                <option key={v} value={v}>
                  {v / 1000000} Mbps
                </option>
              )
            )}
          </select>
        </label>
        <label className={Style.field}>
          <span>最大尺寸</span>
          <select
            value={draft.maxSize}
            onChange={(e) =>
              setDraft({ ...draft, maxSize: Number(e.target.value) })
            }
          >
            <option value={720}>720</option>
            <option value={1280}>1280</option>
            <option value={1920}>1920</option>
            <option value={0}>原始分辨率</option>
          </select>
        </label>
        <label className={Style.field}>
          <span>编码</span>
          <select
            value={draft.codec || 'h264'}
            onChange={(e) =>
              setDraft({ ...draft, codec: e.target.value as 'h264' | 'h265' })
            }
          >
            <option value="h264">H.264</option>
            <option value="h265">H.265（省带宽，需设备支持 HEVC 编码）</option>
          </select>
        </label>
        <div className={Style.fieldHint}>
          设备不支持 HEVC 编码时自动回退 H.264
        </div>
        <label className={Style.field}>
          <span>帧率</span>
          <select
            value={draft.maxFps}
            onChange={(e) =>
              setDraft({ ...draft, maxFps: Number(e.target.value) })
            }
          >
            <option value={15}>15 FPS</option>
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS</option>
          </select>
        </label>
        <div className={Style.dialogBtns}>
          <button className={Style.reboot} onClick={props.onReboot}>
            重启设备
          </button>
          <button onClick={props.onCancel}>取消</button>
          <button className={Style.primary} onClick={() => props.onSave(draft)}>
            保存并重连
          </button>
        </div>
      </div>
    </div>
  )
}
