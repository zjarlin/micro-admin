// 构建期生成的插件加载器（见 build/plugin-catalog.ts）。
declare module 'virtual:plugin-catalog' {
  import type { PluginDefinition } from '@/kernel'

  export const pluginLoaders: Record<string, () => Promise<PluginDefinition>>
}
