# Scrcpy WebCast

Electron 内嵌 Android 投屏：**不打包 scrcpy.exe，也不弹外部窗口**。
把 scrcpy 官方 server（`scrcpy.jar`）推到设备上用 `app_process` 起起来，视频流走
`adb forward` + 自建 socket 通道进入渲染进程，用 **WebCodecs** 解码到 `<canvas>`；
触摸、按键、文本、剪贴板通过 scrcpy 的控制通道回传。

> 投屏模块改编自 [AYA](https://github.com/liriliri/aya)（AGPL-3.0），
> 设备端是 [scrcpy](https://github.com/Genymobile/scrcpy) 官方 server，客户端协议解析用
> [@yume-chan/scrcpy](https://github.com/yume-chan/ya-webadb)。

## 特性

- 纯 JS/TS 链路：主进程只负责 adb，协议解析与解码全在渲染层
- H.264 / H.265（设备与 WebCodecs 都支持时）
- 多信号源切换（`list_displays`，副屏 / 投屏信号源）
- 触摸与鼠标、返回/主页/多任务、电源、音量、亮灭屏、文本输入、Ctrl+V 粘贴 PC 剪贴板
- 截图、录屏（分片直接写盘，不堆内存）、全屏、置顶、按画面比例自适应窗口
- 断线可重连；关闭窗口时同步收掉设备端 server、forward 与残留进程
- 同一设备的启停串行化，避免两次点击互删对方的 forward

## 环境要求

- Node.js 20+（构建用）；本仓库用 Electron 30（Chromium 124，自带 WebCodecs）
- `adb` 能识别的设备，且已开启「USB 调试」（首次需要授权）
- 设备 Android 5.0+（scrcpy-server 3.1 的下限）

## 快速开始

```bash
npm install
npm run build
npm start
```

开发模式（渲染层 HMR + 主进程/preload watch，自动拉起 Electron）：

```bash
npm run dev
```

冒烟截图（启动应用、用 CDP 截当前页面，顺带收集 console 报错）：

```bash
npm run build
node script/smoke.mjs --page webcast --query "device=192.168.1.10:5555&name=demo" --out shot.png
```

## 目录结构

```
resources/
  adb/                platform-tools（Windows 版；换平台替换成对应二进制）
  scrcpy.jar          scrcpy server 3.1
src/
  main/
    adb.ts            adb 进程封装（含 UTF-8 / GBK 判定，避免中文 Windows 乱码）
    webCast.ts        投屏会话：推 jar、起 server、adb forward、等 abstract socket
    recording.ts      录屏分片落盘
    windows/          主窗口 + 投屏窗口（尺寸按视频比例自适应）
  preload/
    index.ts          contextBridge：main.*（IPC）+ node.*（裸 TCP 流）
    stream.ts         渲染层到本机 adb forward 端口的 socket 通道
  renderer/
    home/             设备列表
    webcast/          WebCodecs 播放器与工具栏
```

## 数据流

1. `adb push scrcpy.jar /data/local/tmp/scrcpy-webcast/scrcpy-<ts>.jar`
   —— 每次用不同文件名，避免旧 server 退出时把自己的 jar 删掉
2. `CLASSPATH=... app_process /system/bin com.genymobile.scrcpy.Server 3.1 ... tunnel_forward=true`
3. `adb forward tcp:0 localabstract:scrcpy_<scid>` → 让 adb 自己挑空闲端口
4. 渲染层 `node.connectStream(port)` 建 TCP，`@yume-chan/scrcpy` 做握手与视频元信息解析
5. `WebCodecsVideoDecoder` 解帧 + `InsertableStreamVideoFrameRenderer` 画到 canvas
6. 控制通道（第二条连接）发触摸 / 按键 / 剪贴板

参数全部通过白名单校验后才拼进设备端命令行，避免设备 ID、信号源等字段注入 shell。

## 已知限制

- 音频未接入（`audio: false`）：scrcpy 的 PCM 需要额外播放器，本仓库只做画面
- 只在 Windows + Android 8.1 / 9 上验证过；其他平台理论可用但未测试
- 不含打包配置（electron-builder / NSIS），`npm start` 直接跑构建产物

## 许可

AGPL-3.0（继承 AYA 的投屏实现）。第三方组件与许可见 [NOTICE](NOTICE)。
