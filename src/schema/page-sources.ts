// 页面基线来源：每个插件贡献自己的页面，宿主只做装配。
//
// 这样「装哪些插件」和「有哪些页面/接口」是同一件事：桌面档位不装 RBAC，
// `/system/roles` 之类的接口和用户页上的部门/角色列就都不会出现。
import type { CrudPageSchema } from '@zjarlin/data-page'
import { userPages } from '../plugins/user/data.ts'
import { rbacPages, applyRbacToUserPage } from '../plugins/rbac/data.ts'
import { dictPages } from '../plugins/dict/data.ts'
import { settingsPages } from '../plugins/settings/data.ts'
import { jobPage } from './job.ts'
import { devicePage } from './device.ts'

export interface PageSource {
  pluginId: string
  pages: Record<string, CrudPageSchema>
}

/** 宿主自留的演示页（定时任务、设备台账）跟本仓库绑定，不属于可搬走的插件。 */
export const hostPageSources: PageSource[] = [
  { pluginId: 'monitor', pages: { 'monitor.job': jobPage } },
  { pluginId: 'pages', pages: { 'demo.device': devicePage } },
]

export const pluginPageSources: PageSource[] = [
  { pluginId: 'user', pages: userPages },
  { pluginId: 'rbac', pages: rbacPages },
  { pluginId: 'dict', pages: dictPages },
  { pluginId: 'settings', pages: settingsPages },
]

/** 按档位拼页面基线；RBAC 在场时才给用户页补部门/角色与左树。 */
export function composeBasePages(pluginIds: readonly string[]): Record<string, CrudPageSchema> {
  const pages: Record<string, CrudPageSchema> = {}
  for (const source of [...pluginPageSources, ...hostPageSources]) {
    if (!pluginIds.includes(source.pluginId)) continue
    Object.assign(pages, source.pages)
  }
  const userPage = pages['system.user']
  if (userPage && pluginIds.includes('rbac')) pages['system.user'] = applyRbacToUserPage(userPage)
  return pages
}
