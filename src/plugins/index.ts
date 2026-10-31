import type { PluginDefinition } from '@/kernel'
import { resolvePluginProfile, type ResolvedProfile } from '@/shared/plugin-profiles'
import { pluginLoaders } from 'virtual:plugin-catalog'

/**
 * 构建期档位：`VITE_PLUGIN_PROFILE`，缺省 `admin`。
 *
 * 加载器由 `build/plugin-catalog.ts` 在构建时按档位生成，
 * 所以「没入档的插件」连 chunk 都不会产出；插件目录清单见 `plugins/modules.ts`。
 */
export const activeProfile: ResolvedProfile = resolvePluginProfile(import.meta.env.VITE_PLUGIN_PROFILE)

/** 按档位加载插件；构建档位与运行档位不一致时直接报错，不静默跳插件。 */
export async function loadPluginCatalog(profile: ResolvedProfile = activeProfile): Promise<PluginDefinition[]> {
  return Promise.all(
    profile.ids.map(async (id) => {
      const load = pluginLoaders[id]
      if (!load) {
        throw new Error(`当前构建没有插件 ${id}（档位 ${profile.name}）：构建与运行必须使用同一个 VITE_PLUGIN_PROFILE`)
      }
      return load()
    }),
  )
}
