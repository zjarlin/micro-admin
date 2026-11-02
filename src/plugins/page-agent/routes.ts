import type { RouteContribution } from '@/kernel'

/**
 * 旧地址保活：设置已并入「系统设置 → 页面助手」。
 *
 * 这里只留跳转，不再有独立页面与菜单——同一个设置项只能有一个入口。
 * 顶栏的助手入口是外壳图纸上的一个图标（点击执行 `page-agent.toggle` 命令），不是菜单项。
 */
export const routes: RouteContribution[] = [
  {
    name: 'page-agent-settings',
    path: '/system/page-agent',
    redirect: '/system/settings?tab=assistant',
    title: '页面助手',
    permission: 'system:page-agent:config',
  },
]

export const menus: never[] = []
