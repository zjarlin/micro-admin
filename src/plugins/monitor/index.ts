import { defineAsyncComponent } from 'vue'
import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

export const monitorPlugin: PluginDefinition = {
  id: 'monitor',
  name: '系统监控',
  version: '1.0.0',
  description: '在线用户、定时任务、服务状态与缓存观测。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.slots.add({
      name: 'dashboard:after-metrics',
      id: 'monitor-health-card',
      order: 10,
      component: defineAsyncComponent(() => import('./components/HealthCard.vue')),
    })
    return () => ctx.logger.debug('monitor plugin disposed')
  },
}
