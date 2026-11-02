import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installDataPage } from '@zjarlin/data-page-element'
import { installPermissionMeta } from '@addzero/permission-meta/runtime'
import { bootKernel, installPluginRoutes, router } from './router'
import { createRuntime, RUNTIME_KEY } from './shared/service'
import { http } from './shared/api'
import { useSessionStore } from './stores/session'
import { useUiStore } from './stores/ui'
import { applyTheme, loadTheme } from './shared/theme'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'nprogress/nprogress.css'
import './styles/base.scss'
import './styles/admin.scss'

async function bootstrap(): Promise<void> {
  document.title = `${import.meta.env.VITE_APP_TITLE || 'Micro Admin'} · 微内核后台`
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // 先启动内核并安装插件路由，再挂载应用；守卫不会在导航中修改路由表。
  const kernel = await bootKernel()
  installPluginRoutes(kernel)
  const coreContext = kernel.contextFor('core-admin')
  app.provide(RUNTIME_KEY, createRuntime(
    (token) => coreContext.services.get(token),
    coreContext.commands,
    (id) => kernel.getStatus(id)?.enabled ?? false,
  ))

  installDataPage(app, { transport: http })
  // v-permission-meta：metaId 在编译期已静态写进指令参数，这里只提供当前会话的授权集合。
  // 本项目的 metaId 直接沿用权限码（如 `monitor:server:view`），后台可据 meta-tree.json 配置。
  installPermissionMeta(app, { granted: () => useSessionStore().permissions })
  app.use(router)
  app.use(ElementPlus, { locale: zhCn as never })
  for (const [name, component] of Object.entries(ElementPlusIconsVue)) app.component(name, component)
  useUiStore().apply()
  // 外观是后端配置：挂载前拉一次并写成 CSS 变量，避免先闪一下默认配色。
  applyTheme(await loadTheme(http), document.documentElement.classList.contains('dark'))
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
