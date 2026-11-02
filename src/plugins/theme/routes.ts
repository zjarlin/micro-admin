import type { RouteContribution } from '@/kernel'

/**
 * 旧地址保活：外观设置已并入「系统设置 → 界面外观」。
 *
 * 同一个设置项只保留一个入口：侧栏不再出现「外观主题」菜单，
 * 老收藏/老标签页仍能落到新位置。
 */
export const routes: RouteContribution[] = [
  {
    name: 'system-theme',
    path: '/system/theme',
    redirect: '/system/settings?tab=appearance',
    title: '外观主题',
    permission: 'system:theme:config',
  },
]

export const menus: never[] = []
