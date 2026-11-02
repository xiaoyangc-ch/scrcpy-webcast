import { app, BrowserWindow } from 'electron'
import * as window from '../window'

let win: BrowserWindow | null = null

export function showWin() {
  if (win && !win.isDestroyed()) {
    win.focus()
    return
  }

  win = window.create({
    name: 'main',
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
  })
  win.on('close', () => app.quit())
  win.on('closed', () => {
    win = null
  })
  window.loadPage(win)
}

