// 构建期生成插件加载器：清单（档位）是唯一真相，加载器由生成器产出，不手写第二份。
//
// 之所以不在运行期过滤：静态 import 的插件即使不启用也会进包，
// 「桌面档位只要用户插件」就落不了地。这里的生成结果是虚拟模块，
// 未入档的插件不会出现，Rollup 也就不会为它生成 chunk。
import type { Plugin } from 'vite'
import { pluginModules } from '../src/plugins/modules.ts'
import { resolvePluginProfile } from '../src/shared/plugin-profiles.ts'

const VIRTUAL_ID = 'virtual:plugin-catalog'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

export function pluginCatalog(profileName?: string): Plugin {
  return {
    name: 'micro-admin:plugin-catalog',
    enforce: 'pre',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      const { name, ids } = resolvePluginProfile(profileName)
      const entries = ids.map((pluginId) => {
        const ref = pluginModules[pluginId]
        if (!ref) throw new Error(`插件档位 ${name} 里有未登记的插件：${pluginId}`)
        return `  ${JSON.stringify(pluginId)}: () => import(${JSON.stringify(ref.file)}).then((module) => module.${ref.export}),`
      })
      return [
        `// 由 build/plugin-catalog.ts 按档位 ${name} 生成，勿手改。`,
        'export const pluginLoaders = {',
        ...entries,
        '}',
        '',
      ].join('\n')
    },
  }
}
