/**
 * 渲染进程用到的 IPC 类型：只保留投屏相关，业务侧接口不进这个仓库
 */

export interface IDevice {
  id: string
  name: string
  type: 'emulator' | 'device' | 'offline' | 'unauthorized' | 'unknown'
  androidVersion?: string
}

export type IpcGetDevices = () => Promise<IDevice[]>

export type IpcReverseWebCast = (
  deviceId: string,
  remote: string
) => Promise<{ ok: boolean; port: number; error?: string }>

export type IpcStartWebCast = (
  deviceId: string,
  args: string[]
) => Promise<{ ok: boolean; error?: string }>

export type IpcStopWebCast = (deviceId: string) => Promise<void>

export type IpcShowWebCast = (deviceId: string, name: string) => Promise<void>

export type IpcWaitWebCast = (
  deviceId: string,
  scid: string
) => Promise<{ ok: boolean }>

export type IpcWebCastDisplays = (
  deviceId: string
) => Promise<{ id: number; name: string }[]>

export type IpcInstallWebCastApk = (
  deviceId: string,
  apkPath: string
) => Promise<{ ok: boolean; message: string }>

export type IpcWebCastOnTop = (
  deviceId: string,
  onTop: boolean
) => Promise<void>

export type IpcResizeWebCast = (
  deviceId: string,
  videoWidth: number,
  videoHeight: number
) => Promise<void>

export type IpcRecordingStart = (
  deviceId: string
) => Promise<{ id: string; path: string }>

export type IpcRecordingChunk = (
  id: string,
  data: Uint8Array
) => Promise<void>

export type IpcRecordingStop = (id: string) => Promise<{ path: string }>

export type IpcGetStore = (name: string) => Promise<any>
export type IpcSetStore = (name: string, val: any) => Promise<void>

export type IpcGetInputMethod = (deviceId: string) => Promise<string>
export type IpcReadClipboard = () => Promise<string>
export type IpcRebootDevice = (deviceId: string) => Promise<void>
