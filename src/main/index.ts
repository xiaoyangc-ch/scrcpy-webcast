import { app, clipboard } from 'electron'
import { getInputMethod, listDevices, rebootDevice } from './adb'
import { handleEvent } from 'share/main/lib/util'
import * as webCast from './webCast'
import * as webCastWindow from './windows/webcast'
import * as mainWindow from './windows/main'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => mainWindow.showWin())

  app.on('ready', () => {
    webCast.init()
    webCastWindow.init()

    // 设备列表给首页用
    handleEvent('getDevices', listDevices)
    handleEvent('getInputMethod', getInputMethod)
    handleEvent('rebootDevice', rebootDevice)
    // 投屏工具栏的 Ctrl+V：渲染层 navigator.clipboard 在失焦时会慢或返回空
    handleEvent('writeClipboard', (text: string) => clipboard.writeText(text))
    handleEvent('readClipboard', () => clipboard.readText())

    mainWindow.showWin()
  })

  app.on('window-all-closed', () => app.quit())
}

