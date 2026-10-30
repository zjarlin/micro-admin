import type { PluginDefinition } from '@/kernel'
import { coreAdminPlugin } from './core-admin'
import { systemPlugin } from './system'
import { monitorPlugin } from './monitor'
import { scadaPlugin } from './scada'
import { pagesPlugin } from './pages'
import { uiCanvasPlugin } from './ui-canvas'

/** 插件清单：新增业务域只改这一处，宿主不感知具体页面。 */
export const pluginCatalog: PluginDefinition[] = [
  coreAdminPlugin,
  systemPlugin,
  monitorPlugin,
  scadaPlugin,
  pagesPlugin,
  uiCanvasPlugin,
]
