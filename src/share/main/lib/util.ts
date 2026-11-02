import path from 'path'
import types from 'licia/types'
import { app, ipcMain } from 'electron'

export function isDev() {
  return !app.isPackaged
}

/**
 * resources 在开发时位于仓库根目录，打包后由 extraResources 放到 process.resourcesPath
 */
export function resolveResources(p: string) {
  return isDev()
    ? path.resolve(__dirname, '../../resources', p)
    : path.resolve(process.resourcesPath, p)
}

export function getUserDataPath(p: string) {
  return path.resolve(app.getPath('userData'), p)
}

export function handleEvent(channel: string, listener: types.AnyFn) {
  ipcMain.handle(channel, (_event: any, ...args: any[]) => listener(...args))
}
