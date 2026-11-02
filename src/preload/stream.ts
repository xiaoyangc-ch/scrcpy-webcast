import net from 'node:net'

/**
 * 渲染层到 adb forward 端口的裸 TCP 通道。
 * scrcpy 的握手/音视频都是自定义协议，不能在 Chromium 里直接开 socket，
 * 由 preload 用 net 建连、把数据块丢给渲染层喂给 @yume-chan/scrcpy。
 */
const sockets = new Map<number, net.Socket>()
let seq = 0

export default {
  connectStream: function (
    port: number,
    handlers: {
      onConnect: () => void
      onData: (data: Uint8Array) => void
      onClose: () => void
      onError: (message: string) => void
    }
  ): number {
    const id = ++seq
    const socket = net.connect(port, '127.0.0.1')
    sockets.set(id, socket)
    socket.on('connect', () => handlers.onConnect())
    socket.on('data', (data: Buffer) => handlers.onData(new Uint8Array(data)))
    socket.on('close', () => {
      sockets.delete(id)
      handlers.onClose()
    })
    socket.on('error', (err: Error) => {
      sockets.delete(id)
      handlers.onError(err && err.message ? err.message : String(err))
    })
    return id
  },

  writeStream: function (id: number, data: Uint8Array) {
    const socket = sockets.get(id)
    if (socket) socket.write(data)
  },

  closeStream: function (id: number) {
    const socket = sockets.get(id)
    sockets.delete(id)
    if (socket) socket.destroy()
  },
}
