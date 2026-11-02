import types from 'licia/types'

/**
 * 极简 i18n：中文键直接返回原文（App.tsx 里有中文字面量直接当 key 用的写法），
 * 英文键查字典，查不到就回退成 key 本身——与 licia/I18n 的行为一致。
 */
const dict: types.PlainObj<string> = {
  alwaysOnTop: '置顶',
  appSwitch: '应用切换',
  back: '返回',
  canvas: 'Canvas',
  fullscreen: '全屏',
  home: '主界面',
  inputText: '输入文本',
  ok: '确定',
  cancel: '取消',
  power: '电源',
  restart: '重启',
  screenOff: '关闭设备屏幕',
  screenOn: '开启设备屏幕',
  screenshot: '截屏',
  settings: '设置',
  volumeDown: '减小音量',
  volumeUp: '增加音量',
}

let locale = 'zh-CN'

export const i18n = {
  locale(lang?: string) {
    if (lang) locale = lang
    return locale
  },
  t(path: string | string[], data?: types.PlainObj<any>) {
    return translate(path, data)
  },
}

function translate(
  path: string | string[],
  data?: types.PlainObj<any>
): string {
  const key = Array.isArray(path) ? path.join('.') : path
  let text = locale === 'zh-CN' ? dict[key] : undefined
  if (text === undefined) {
    text = key
  }
  if (data) {
    return text.replace(/\{(\w+)\}/g, (all, name) =>
      name in data ? String(data[name]) : all
    )
  }
  return text
}

export function t(path: string | string[], data?: types.PlainObj<any>) {
  return translate(path, data)
}
