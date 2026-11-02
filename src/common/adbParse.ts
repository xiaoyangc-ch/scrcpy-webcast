import { isUtf8 } from 'node:buffer'

/**
 * adb（尤其是 Windows 上的 adb.exe）输出可能是 GBK。
 * 必须整段判定编码再解码，逐块解码会在多字节字符被切开时误判，出现乱码。
 */
export function decodeAdbOutput(chunks: Buffer[]): string {
  const buf = Buffer.concat(chunks)
  if (!buf.length) return ''
  try {
    return isUtf8(buf) ? buf.toString('utf8') : new TextDecoder('gbk').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}
