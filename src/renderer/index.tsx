import { lazy } from 'react'
import { createRoot } from 'react-dom/client'
import getUrlParam from 'licia/getUrlParam'
import LunaModal from 'luna-modal'
import { t } from 'common/util'
import 'luna-toolbar/css'
import 'luna-modal/css'
import './icon.css'
import './styles.scss'

function renderApp() {
  const container = document.getElementById('app') as HTMLElement

  let App = lazy(() => import('./home/App') as Promise<any>)
  let title = 'Scrcpy WebCast'

  if (getUrlParam('page') === 'webcast') {
    App = lazy(() => import('./webcast/App') as Promise<any>)
    title = '投屏'
  }

  preload.setTitle(title)
  createRoot(container).render(<App />)
}

LunaModal.i18n.locale('en-US')
LunaModal.i18n.set('en-US', {
  ok: t('ok'),
  cancel: t('cancel'),
})

renderApp()
