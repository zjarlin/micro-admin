// 宿主装配：把「通用页面后端」与「本仓库业务（种子 / 组态）」接在一起。
//
// 框架能力（Hono 路由、鉴权、错误信封、schema 存储、CRUD）全在 `@addzero/ui-server`；
// 这里只做三件事：给种子、挂业务扩展、读配置。
import { createApp as createUiApp, type CreatedApp } from '@addzero/ui-server'
import type { PageData, RuntimeStore, PageStore, Row, SessionResolver } from '@addzero/data-page'
import type { KeyValueStore } from '@addzero/ui-server'
import { seedPages } from '../src/schema/seed.ts'
import { createPageRegistry } from '../src/schema/registry.ts'
import type { SchemaStateStore } from '@addzero/data-page'
import { createScadaPlugin } from './plugins/scada/index.ts'
import { createAiPlugin } from './plugins/ai/index.ts'
import { createThemePlugin } from './plugins/theme/index.ts'
import { createPageAgentPlugin } from './plugins/page-agent/index.ts'
import { createUiCanvasPlugin } from './plugins/ui-canvas/index.ts'

export interface HostDeps {
  pages: PageStore
  runtime: RuntimeStore
  schemas: SchemaStateStore
  kv: KeyValueStore
  corsOrigins?: string[] | undefined
  staticDir?: string | undefined
}

export interface HostApp extends CreatedApp {
  /** 供测试/自检读取当前生效的种子形状。 */
  seed: () => PageData
}

function rowsOf(data: PageData, endpoint: string): Row[] {
  const rows = data[endpoint]
  return Array.isArray(rows) ? rows : []
}

/**
 * 角色授权 → 会话权限码。
 *
 * 「角色管理 → 授权菜单」写的是角色的 `menuIds`；这里在每次请求时按菜单表把它翻成
 * 权限码，因此**改完授权、刷新页面就生效**，不需要重启服务，也不需要在两个地方
 * 各维护一份权限表。
 *
 * 三个刻意的取舍：
 * - 菜单表为空（库里还没播种）时不做接管，回落到静态用户，避免把所有人一次锁死；
 * - 通配角色（`*:*:*`）原样放行，超管不该因为菜单勾选被收窄；
 * - 权限码以**菜单表当前值**为准，菜单管理里改了 `permission`，角色授权自动跟上。
 */
function createSessionResolver(pages: PageStore): SessionResolver {
  return (user) => {
    const data = pages.read()
    const roles = rowsOf(data, '/system/roles')
    const menus = rowsOf(data, '/system/menus')
    if (roles.length === 0) return null

    // 本数据集是单角色（`SysUser.roleId`），多角色时取第一个命中的即可。
    const role = roles.find((row) => user.roles.includes(String(row.code ?? '')))
    if (!role) return null

    // 存量库的老角色行没有这两个字段：此时不接管，回落到静态用户，
    // 免得升级瞬间把所有人权限清空（真正的迁移见 `migrateRoleGrants`）。
    if (role.menuIds === undefined && role.permissions === undefined) return null

    const stored = Array.isArray(role.permissions) ? role.permissions.map(String) : []
    if (stored.includes('*:*:*')) return { ...user, permissions: ['*:*:*'] }
    if (menus.length === 0) return { ...user, permissions: stored }

    const menuIds = new Set((Array.isArray(role.menuIds) ? role.menuIds : []).map((id) => String(id)))
    const permissions = [...new Set(
      menus
        .filter((menu) => menuIds.has(String(menu.id)) && String(menu.permission ?? '').trim() !== '')
        .map((menu) => String(menu.permission).trim()),
    )].sort()
    return { ...user, permissions }
  }
}

const ROLE_GRANT_FIELDS = ['menuIds', 'permissions'] as const

/**
 * 存量库迁移：老版本的角色行没有 `menuIds` / `permissions` 两列。
 *
 * 按种子里的同 `code` 角色补一次，避免升级后「授权菜单」先是空白、
 * 甚至因为空授权把超管和管理员的权限清空。只补缺失的行，已有授权一律不动。
 */
function migrateRoleGrants(pages: PageStore): void {
  const data = pages.read()
  const roles = rowsOf(data, '/system/roles')
  if (roles.length === 0) return
  const blueprint = rowsOf(seedPages(), '/system/roles')
  let changed = false
  const next = roles.map((row) => {
    if (ROLE_GRANT_FIELDS.some((field) => row[field] !== undefined)) return row
    const template = blueprint.find((seed) => String(seed.code ?? '') === String(row.code ?? ''))
    if (!template) return row
    changed = true
    return { ...row, menuIds: [...(template.menuIds as unknown[])], permissions: [...(template.permissions as unknown[])] }
  })
  if (changed) pages.write({ ...data, '/system/roles': next })
}

export function createApp(deps: HostDeps): HostApp {
  const scada = createScadaPlugin({ kv: deps.kv })
  // AI 插件依赖组态插件的图元/变量清单（同一份能力），不自己再读一份 JSON。
  const ai = createAiPlugin({ kv: deps.kv, symbols: scada.symbols, tags: scada.tags })
  const theme = createThemePlugin({ kv: deps.kv })
  // 页面助手：设置与密钥都留在后端，浏览器只拿公开视图 + 同源代理。
  const pageAgent = createPageAgentPlugin({ kv: deps.kv })
  // 图纸插件必须拿到「已装配的注册表」：发布就是把编译结果 upsert 进去。
  const registry = createPageRegistry(deps.schemas)
  const uiCanvas = createUiCanvasPlugin({ kv: deps.kv, registry })

  const created = createUiApp({
    pages: deps.pages,
    runtime: deps.runtime,
    registry,
    seed: seedPages,
    extensions: [scada, ai, theme, pageAgent, uiCanvas],
    // 外观要在登录页就生效，因此主题读取免登录；写入仍要权限码。
    // 页面助手只公开「顶栏入口视图」（外观/可见性）；完整设置与代理调用都要登录。
    // 会话权限由角色的「授权菜单」派生：角色管理里改完即生效，不需要发版。
    resolveUser: createSessionResolver(deps.pages),
    publicPaths: ['/ui/theme', '/page-agent/entry'],
    ...(deps.corsOrigins ? { corsOrigins: deps.corsOrigins } : {}),
    ...(deps.staticDir ? { staticDir: deps.staticDir } : {}),
  })

  // 先读一次角色表：空库会在这里把种子落盘，随后才能判断哪些行需要补授权字段。
  created.engine.rows('/system/roles')
  migrateRoleGrants(deps.pages)

  return { ...created, seed: seedPages }
}
