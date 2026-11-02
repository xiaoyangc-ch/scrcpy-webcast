import memoize from 'licia/memoize'
import FileStore from 'licia/FileStore'
import { getUserDataPath } from 'share/main/lib/util'

export const getScreencastStore = memoize(function () {
  return new FileStore(getUserDataPath('data/screencast.json'), {
    settings: {},
    alwaysOnTop: false,
  })
})

export const getWindowStore = memoize(function () {
  return new FileStore(getUserDataPath('data/windows.json'), {})
})
