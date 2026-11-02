import type { PluginDefinition } from '@/kernel'
import { menus, routes } from './routes'
import { themeSettings } from './settings'

/**
 * 外观插件（前端）。
 *
 * 主题值存在后端 `ui:theme`，浏览器只把它翻译成 CSS 变量：
 * 因此换品牌色、圆角、密度不需要改组件、不需要发版，也不需要理解前端代码。
 * 模型生成走 AI 插件的 `/ai/theme`；本插件不依赖 AI 才能用——AI 只是加速器。
 */
export const themePlugin: PluginDefinition = {
  id: 'theme',
  name: '外观主题',
  version: '1.0.0',
  description: '品牌色、圆角、密度的可视化配置与 AI 生成，改完立即全站生效。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    // 设置并入系统设置页的「界面外观」分组；本插件不再单独建设置页。
    ctx.settings.add(themeSettings)
  },
}
