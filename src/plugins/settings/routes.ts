import type { MenuContribution, RouteContribution } from '@/kernel'

/**
 * 系统工具页面的唯一入口。
 *
 * 「参数设置 / 通知公告」是手写页面；「系统设置」是各插件贡献的聚合容器，
 * 标签页由贡献的分组自动生成（见 `SettingsPage.vue`）。
 */
export const routes: RouteContribution[] = [
  { name: 'config', path: '/system/config', component: () => import('./pages/ConfigPage.vue'), title: '参数设置', permission: 'system:config:list' },
  { name: 'notice', path: '/system/notice', component: () => import('./pages/NoticePage.vue'), title: '通知公告', permission: 'system:notice:list' },
  {
    name: 'system-settings',
    path: '/system/settings',
    component: () => import('./SettingsPage.vue'),
    title: '系统设置',
    permission: 'system:settings:view',
    meta: { icon: 'Tools', group: '系统工具' },
  },
]

export const menus: MenuContribution[] = [
  { id: 'sys-config', title: '参数设置', path: '/system/config', icon: 'Setting', group: '系统工具', order: 70, permission: 'system:config:list' },
  { id: 'sys-notice', title: '通知公告', path: '/system/notice', icon: 'Bell', group: '系统工具', order: 80, permission: 'system:notice:list' },
  {
    id: 'system-settings',
    title: '系统设置',
    path: '/system/settings',
    icon: 'Tools',
    group: '系统工具',
    order: 65,
    permission: 'system:settings:view',
  },
]
