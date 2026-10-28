import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { MicroKernel, type PluginDefinition } from '@/kernel'
import { pluginCatalog } from '@/plugins'
import { http } from '@/shared/api'
import { useSessionStore } from '@/stores/session'

const Layout = () => import('@/layouts/AdminLayout.vue')

let kernel: MicroKernel | null = null
let routesInstalled = false

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
  ],
})

/**
 * 路由在应用挂载前一次性安装完成。
 * 权限与插件启停放在守卫里判断，避免“登录后动态 addRoute”与导航重放互相等待。
 */
export function compilePluginRoutes(instance: MicroKernel): RouteRecordRaw[] {
  const children: RouteRecordRaw[] = instance.routeContributions().map((route) => ({
    path: route.path.replace(/^\//, ''),
    name: route.name,
    component: route.component,
    meta: {
      title: route.title,
      permission: route.permission,
      pluginId: route.pluginId,
      ...route.meta,
    },
  }))
  return [{ path: '/', component: Layout, redirect: '/dashboard', children }]
}

export async function bootKernel(plugins: PluginDefinition[] = pluginCatalog): Promise<MicroKernel> {
  if (kernel) return kernel
  kernel = new MicroKernel({
    plugins,
    onError: (pluginId, error) => console.error(`[kernel] plugin ${pluginId} failed`, error),
  })
  kernel.provideService('http', http)
  await kernel.start()
  return kernel
}

export function getKernel(): MicroKernel | null {
  return kernel
}

export function installPluginRoutes(instance: MicroKernel): void {
  if (routesInstalled) return
  for (const record of compilePluginRoutes(instance)) router.addRoute(record)
  routesInstalled = true
}

router.beforeEach(async (to) => {
  const session = useSessionStore()

  if (to.meta.public) {
    return session.isAuthenticated ? { path: '/dashboard' } : true
  }

  if (!session.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (!session.initialized) {
    try {
      await session.restore()
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }

  const pluginId = typeof to.meta.pluginId === 'string' ? to.meta.pluginId : undefined
  if (pluginId && !kernel?.getStatus(pluginId)?.enabled) return { path: '/dashboard' }

  const permission = typeof to.meta.permission === 'string' ? to.meta.permission : undefined
  if (permission && !session.can(permission)) return { path: '/dashboard' }

  return true
})

export function resetKernelForTests(): void {
  kernel = null
  routesInstalled = false
}
