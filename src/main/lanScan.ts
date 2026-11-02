import net from 'node:net'
import os from 'node:os'
import { spawnAdb } from './adb'

const ADB_PORT = 5555
const PROBE_TIMEOUT = 400
const CONCURRENCY = 128
// 单个网段最多扫这么多地址：/22 约 1022 个，够用又不至于把办公网扫穿
const MAX_HOSTS = 1024

const ipToNum = (ip: string) =>
  ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
const numToIp = (n: number) =>
  [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

export function subnetHosts(ip: string, netmask: string): string[] {
  const ipNum = ipToNum(ip)
  const maskNum = ipToNum(netmask)
  const network = (ipNum & maskNum) >>> 0
  const broadcast = (network | (~maskNum >>> 0)) >>> 0
  let start = network + 1
  let end = broadcast - 1
  if (end < start) return []
  if (end - start + 1 > MAX_HOSTS) {
    // 大网段（/16 之类）只扫本机所在的 /24，避免几万个探测把网络打满
    const base = (ipNum & 0xffffff00) >>> 0
    start = base + 1
    end = base + 254
  }
  const hosts: string[] = []
  for (let n = start; n <= end; n++) {
    const host = numToIp(n)
    if (host === ip) continue
    if (host.endsWith('.0') || host.endsWith('.255')) continue
    hosts.push(host)
  }
  return hosts
}

function localCandidates(): string[] {
  const seen = new Set<string>()
  const hosts: string[] = []
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      if (ni.address.startsWith('127.') || ni.address.startsWith('169.254.')) {
        continue
      }
      for (const host of subnetHosts(ni.address, ni.netmask || '255.255.255.0')) {
        if (seen.has(host)) continue
        seen.add(host)
        hosts.push(host)
      }
    }
  }
  return hosts
}

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(PROBE_TIMEOUT)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

/**
 * 扫本机所有网段的 5555 端口（adb tcpip 默认端口），
 * 命中的地址逐个 `adb connect`，连上的会出现在设备列表里。
 */
export async function scanLan(): Promise<{
  scanned: number
  found: { id: string; connected: boolean }[]
}> {
  const hosts = localCandidates()
  const open: string[] = []
  await forEachLimit(hosts, CONCURRENCY, async (host) => {
    if (await probe(host, ADB_PORT)) open.push(host)
  })

  const found: { id: string; connected: boolean }[] = []
  for (const ip of open.sort((a, b) => ipToNum(a) - ipToNum(b))) {
    const id = `${ip}:${ADB_PORT}`
    try {
      const r = await spawnAdb(['connect', id], 8000)
      const out = `${r.stdout || ''}\n${r.stderr || ''}`
      const connected = /connected/i.test(out) && !/cannot|failed|refused/i.test(out)
      found.push({ id, connected })
    } catch {
      found.push({ id, connected: false })
    }
  }

  return { scanned: hosts.length, found }
}
