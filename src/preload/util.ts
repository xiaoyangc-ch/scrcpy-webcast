/* eslint-disable */
import { ipcRenderer } from 'electron'

/**
 * 包一层 ipcRenderer.invoke：渲染层按普通 async 函数调用，
 * 通道名只出现在 preload，渲染层看不到 ipc 细节。
 */
export function invoke<T extends Function>(channel: string) {
  return function (...args: any[]) {
    return ipcRenderer.invoke(channel, ...args)
  } as Promisify<T>
}

type Params<F extends Function> = F extends (...args: infer L) => any ? L : never
type Ret<F extends Function> = F extends (...args: any[]) => infer R ? R : never
type Promisify<F extends Function> = Ret<F> extends Promise<any>
  ? F
  : (...args: Params<F>) => Promise<Ret<F>>
