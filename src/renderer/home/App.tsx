import { useCallback, useEffect, useState } from 'react'
import { IDevice } from 'common/types'
import Style from './Home.module.scss'

const STATUS_TEXT: Record<IDevice['type'], string> = {
  device: '已连接',
  emulator: '模拟器',
  offline: '离线',
  unauthorized: '未授权',
  unknown: '未知',
}

export default function App() {
  const [devices, setDevices] = useState<IDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState('')

  const load = useCallback(async () => {
    try {
      setDevices(await main.getDevices())
      setError('')
    } catch (e: any) {
      setDevices([])
      setError(e && e.message ? e.message : String(e))
    }
  }, [])

  // 手动刷新才走 loading：定时轮询如果也置 loading，「刷新」按钮会一直闪
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await load()
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    refresh()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [refresh, load])

  const scan = useCallback(async () => {
    setScanning(true)
    setScanInfo('正在扫描本机网段的 5555 端口…')
    try {
      const r = await main.scanLanDevices()
      const connected = r.found.filter((f) => f.connected).length
      setScanInfo(
        `扫描 ${r.scanned} 个地址，${r.found.length} 台开着调试端口，已连接 ${connected} 台`
      )
      await load()
    } catch (e: any) {
      setScanInfo(`扫描失败：${e && e.message ? e.message : e}`)
    } finally {
      setScanning(false)
    }
  }, [load])

  return (
    <div className={Style.container}>
      <div className={Style.header}>
        <div className={Style.title}>设备</div>
        <div className={Style.count}>{devices.length} 台</div>
        <button className={Style.scan} onClick={scan} disabled={scanning}>
          {scanning ? '扫描中…' : '扫描局域网'}
        </button>
        <button className={Style.refresh} onClick={refresh} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {scanInfo ? <div className={Style.banner}>{scanInfo}</div> : null}

      {error ? <div className={Style.error}>{error}</div> : null}

      <div className={Style.list}>
        {devices.length === 0 && !error ? (
          <div className={Style.empty}>
            <div className={Style.emptyTitle}>未发现设备</div>
            <div className={Style.emptyDesc}>
              用 USB 连接手机并开启「USB 调试」后会自动出现；
              <br />
              也可以先执行 <code>adb connect 192.168.1.10:5555</code> 走网络连接。
            </div>
          </div>
        ) : null}

        {devices.map((device) => {
          const online = device.type === 'device' || device.type === 'emulator'
          return (
            <div className={Style.item} key={device.id}>
              <span
                className={Style.dot}
                data-online={online ? 'yes' : 'no'}
              ></span>
              <div className={Style.info}>
                <div className={Style.name}>{device.name}</div>
                <div className={Style.meta}>
                  {device.id}
                  {device.androidVersion ? ` · Android ${device.androidVersion}` : ''}
                  {` · ${STATUS_TEXT[device.type]}`}
                </div>
              </div>
              <button
                className={Style.cast}
                disabled={!online}
                onClick={() => main.showWebCast(device.id, device.name)}
              >
                投屏
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
