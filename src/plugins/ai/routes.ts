import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  {
    name: 'ai-studio',
    path: '/ai/studio',
    component: () => import('./pages/AiStudioPage.vue'),
    title: 'AI 工作台',
    permission: 'ai:studio:view',
    meta: { icon: 'MagicStick', group: 'AI' },
  },
]

export const menus: MenuContribution[] = [
  {
    id: 'ai-studio',
    title: 'AI 工作台',
    path: '/ai/studio',
    icon: 'MagicStick',
    group: 'AI',
    order: 15,
    permission: 'ai:studio:view',
  },
]
