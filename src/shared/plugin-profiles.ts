// 插件档位：一种发行形态对应一份启用清单，前后端读同一份定义。
//
// - `admin`：完整后台（默认）。
// - `desktop`：只打包登录、用户与字典，给「组态王」这类只有用户表的工具类产品用。
//
// 前端用 `VITE_PLUGIN_PROFILE`，后端用 `PLUGIN_PROFILE`；两处取值必须一致，
// 否则页面会出现「前端有菜单、后端没接口」。取到未知档位直接报错，不静默回退。
export const pluginProfiles = {
  admin: [
    'core-admin',
    'user',
    'rbac',
    'dict',
    'settings',
    'monitor',
    'scada',
    'ui-canvas',
    'pages',
  ],
  desktop: ['core-admin', 'user', 'dict'],
} as const satisfies Record<string, readonly string[]>

export type PluginProfileName = keyof typeof pluginProfiles

export interface ResolvedProfile {
  name: PluginProfileName
  ids: readonly string[]
}

export function resolvePluginProfile(name?: string | null): ResolvedProfile {
  const key = (name ?? '').trim() || 'admin'
  if (!Object.hasOwn(pluginProfiles, key)) {
    throw new Error(`未知插件档位：${key}（可选：${Object.keys(pluginProfiles).join(' / ')}）`)
  }
  const profileName = key as PluginProfileName
  return { name: profileName, ids: pluginProfiles[profileName] }
}
