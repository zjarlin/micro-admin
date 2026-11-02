import type { Router } from 'vue-router'
import type { PluginDefinition } from '@/kernel'
import { createSourceFinderRuntime } from './picker'

/**
 * 源定位插件：点页面元素 → 直接看到它写在哪个文件第几行。
 *
 * 四条边界（与微内核约定一致）：
 * - 位置信息由编译期写进 DOM（`@zjarlin/source-locator/vite`），运行时不再猜；
 * - 拾取器实例归本插件服务，换页不重建，也不会残留全局监听；
 * - 唯一入口是外壳图纸上的一个「瞄准」图标 + 快捷键 ⌘/Ctrl+⇧+E，
 *   两者都调同一个 `source-finder.pick` 命令，不做第二套 UI；
 * - 配置驱动的页面没有 `.vue`，由插件的 `describePage` 回答「这一页来自哪份 schema」。
 */
export const sourceFinderPlugin: PluginDefinition = {
  id: 'source-finder',
  name: '源定位',
  version: '1.0.0',
  description: '页面元素拾取器：点一下元素就看到对应源码文件与行号，并给出当前页面的配置来源。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    // 路由是宿主能力：插件只读当前路由，不 import 宿主 router 模块。
    const router = ctx.services.get<Router>('router')
    const runtime = createSourceFinderRuntime({
      route: () => router?.currentRoute.value ?? null,
      // 基线注册表是「这个 key 在哪定义」的唯一真实入口；运行期覆盖层在 SQLite 里。
      schemaIndexFile: 'src/schema/registry.ts',
    })
    ctx.services.register('source-finder.runtime', runtime)

    // 外壳图纸上的「瞄准」图标配的就是这个命令（顶栏快捷键 ⌘/Ctrl+⇧+E 也走同一条路径）。
    ctx.commands.register('source-finder.pick', () => {
      runtime.toggle()
      return runtime.active.value
    })

    return () => runtime.dispose()
  },
}
