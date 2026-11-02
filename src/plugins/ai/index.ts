import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'
import { createCanvasDrawTool } from './canvas-tool'
import AiDrawPanel from './components/AiDrawPanel.vue'

/**
 * AI 插件。
 *
 * 定位：AI 不是宿主内建能力，而是一个「可以被禁用、也可以依赖别人」的插件——
 * - 依赖 `scada`：只通过对方公开的 `workbench` 句柄改画布，不 import 页面；
 * - 贡献 `scada:assistant` 槽位：组态右栏的 AI 页签内容（指令集生成 + 应用）；
 * - 贡献 `ai.canvasTool` 服务：把「按自然语言改画布」暴露成一个工具，
 *   通用页面助手（`page-agent`）在画布页就能用同一个对话框直接下笔——
 *   这是「复用页面助手对话框」而不是再养第二个助手的关键；
 * - 提示词与模型配置都在后端（`/ai/*`），换模型、调提示词不用改代码。
 */
export const aiPlugin: PluginDefinition = {
  id: 'ai',
  name: 'AI 助手',
  version: '1.0.0',
  description: '提示词库 + 组态指令生成：自然语言直接改画布，绘图与排版都由指令集完成。',
  author: 'Micro Admin',
  requires: ['core-admin', 'scada'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.slots.add({ name: 'scada:assistant', id: 'ai:draw', component: AiDrawPanel, order: 10 })
    // 工具是「服务」而不是「槽位」：它要被别的插件在运行期调用，而不是渲染出来。
    ctx.services.register('ai.canvasTool', createCanvasDrawTool(ctx.http))
    return () => ctx.logger.debug('ai plugin disposed')
  },
}
