// 插件 id → 模块入口：唯一来源，构建期生成器（build/plugin-catalog.ts）与文档都读它。
//
// 路径写成「相对仓库根」的形式，生成器会直接产出 `import('/src/plugins/<id>')`；
// 未入档的插件不会被生成，因此连 chunk 都不产出。
export interface PluginModuleRef {
  /** 相对仓库根的模块入口。 */
  file: string
  /** 该模块导出的插件对象名。 */
  export: string
}

export const pluginModules: Record<string, PluginModuleRef> = {
  'core-admin': { file: '/src/plugins/core-admin', export: 'coreAdminPlugin' },
  user: { file: '/src/plugins/user', export: 'userPlugin' },
  rbac: { file: '/src/plugins/rbac', export: 'rbacPlugin' },
  dict: { file: '/src/plugins/dict', export: 'dictPlugin' },
  settings: { file: '/src/plugins/settings', export: 'settingsPlugin' },
  monitor: { file: '/src/plugins/monitor', export: 'monitorPlugin' },
  scada: { file: '/src/plugins/scada', export: 'scadaPlugin' },
  'ui-canvas': { file: '/src/plugins/ui-canvas', export: 'uiCanvasPlugin' },
  pages: { file: '/src/plugins/pages', export: 'pagesPlugin' },
}
