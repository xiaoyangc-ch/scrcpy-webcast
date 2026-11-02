import { BrowserWindow } from 'electron'
import path from 'path'
import debounce from 'licia/debounce'
import query from 'licia/query'
import types from 'licia/types'
import { getWindowStore } from './store'

export interface IWinOptions {
  name: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  backgroundColor?: string
}

const wins: types.PlainObj<BrowserWindow> = {}

export function create(opts: IWinOptions) {
  const store = getWindowStore()
  const data = store.get(opts.name) || {}
  const bounds = data.bounds || {}

  const win = new BrowserWindow({
    width: bounds.width || opts.width || 900,
    height: bounds.height || opts.height || 640,
    x: bounds.x,
    y: bounds.y,
    minWidth: opts.minWidth || 640,
    minHeight: opts.minHeight || 480,
    resizable: opts.resizable !== false,
    show: false,
    backgroundColor: opts.backgroundColor || '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // WebCodecs 解出来的帧要和 adb 隧道同源使用，这里保持与 AYA 一致的宽松策略
      webSecurity: false,
      sandbox: false,
    },
  })
  win.setMenu(null)

  win.once('ready-to-show', () => win.show())

  // 记住窗口位置：投屏窗口按画面比例反复 setBounds，下次打开还在原处
  const save = debounce(() => {
    if (win.isDestroyed() || win.isFullScreen()) return
    const saved = store.get(opts.name) || {}
    saved.bounds = win.getBounds()
    store.set(opts.name, saved)
  }, 800)
  win.on('resize', save)
  win.on('moved', save)

  win.on('closed', () => {
    if (wins[opts.name] === win) delete wins[opts.name]
  })

  wins[opts.name] = win
  return win
}

export function loadPage(win: BrowserWindow, q: types.PlainObj<string> = {}) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const qs = query.stringify(q)
    win.loadURL(qs ? `${devUrl}/?${qs}` : devUrl)
    return
  }
  win.loadFile(path.resolve(__dirname, '../renderer/index.html'), { query: q })
}

export function getWin(name: string) {
  return wins[name]
}
