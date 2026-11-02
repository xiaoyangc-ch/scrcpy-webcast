import { contextBridge, ipcRenderer, webUtils } from 'electron'
import stream from './stream'
import { invoke } from './util'
import {
  IpcGetDevices,
  IpcGetInputMethod,
  IpcGetStore,
  IpcInstallWebCastApk,
  IpcReadClipboard,
  IpcRebootDevice,
  IpcRecordingChunk,
  IpcRecordingStart,
  IpcRecordingStop,
  IpcResizeWebCast,
  IpcReverseWebCast,
  IpcSetStore,
  IpcShowWebCast,
  IpcStartWebCast,
  IpcStopWebCast,
  IpcWaitWebCast,
  IpcWebCastDisplays,
  IpcWebCastOnTop,
} from 'common/types'

const mainObj = {
  getDevices: invoke<IpcGetDevices>('getDevices'),
  showWebCast: invoke<IpcShowWebCast>('showWebCast'),
  reverseWebCast: invoke<IpcReverseWebCast>('reverseWebCast'),
  startWebCast: invoke<IpcStartWebCast>('startWebCast'),
  stopWebCast: invoke<IpcStopWebCast>('stopWebCast'),
  waitWebCast: invoke<IpcWaitWebCast>('waitWebCast'),
  getWebCastDisplays: invoke<IpcWebCastDisplays>('getWebCastDisplays'),
  installWebCastApk: invoke<IpcInstallWebCastApk>('installWebCastApk'),
  resizeWebCast: invoke<IpcResizeWebCast>('resizeWebCast'),
  webCastOnTop: invoke<IpcWebCastOnTop>('webCastOnTop'),
  getScreencastStore: invoke<IpcGetStore>('getScreencastStore'),
  setScreencastStore: invoke<IpcSetStore>('setScreencastStore'),
  recordingStart: invoke<IpcRecordingStart>('recordingStart'),
  recordingChunk: invoke<IpcRecordingChunk>('recordingChunk'),
  recordingStop: invoke<IpcRecordingStop>('recordingStop'),
  getInputMethod: invoke<IpcGetInputMethod>('getInputMethod'),
  readClipboard: invoke<IpcReadClipboard>('readClipboard'),
  rebootDevice: invoke<IpcRebootDevice>('rebootDevice'),
  writeClipboard: (text: string) => ipcRenderer.invoke('writeClipboard', text),
}

const preloadObj = {
  setTitle: (title: string) => {
    document.title = title
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('preload', preloadObj)
contextBridge.exposeInMainWorld('main', mainObj)
contextBridge.exposeInMainWorld('node', stream)

declare global {
  const main: typeof mainObj
  const preload: typeof preloadObj
  const node: typeof stream
}
