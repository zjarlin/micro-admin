// Element Plus 适配层门面：schema → 真实页面。
//
// 与 `@addzero/data-page` 的分工：那里只有契约与状态机，这里只做像素与交互。
// 换成其它组件库时，重写这一层即可，业务 schema 一行不改。
import './table-shell.css'
import type { App } from 'vue'
import type { DataTransport } from '@addzero/data-page'
import { DATA_TRANSPORT_KEY } from '@addzero/data-page'
import { elementNotifier } from './notifier.ts'
import SchemaPage from './SchemaPage.vue'
import CrudPage from './CrudPage.vue'
import TreePage from './TreePage.vue'

export { elementNotifier, SchemaPage, CrudPage, TreePage }
export { resolveTransport } from './transport.ts'
export type { Notifier } from '@addzero/data-page'

/**
 * 宿主一次性装配：注入传输实现，并全局注册壳组件。
 *
 * 用 `app.provide` 而不是 `provide()`：后者只能在组件 setup 里调用，
 * 装配发生在 `createApp` 之后、挂载之前，属于应用级注入。
 * 之后任何页面只要 `<SchemaPage page-key="..." />` 就能出现，不必再声明数据来源。
 */
export function installDataPage(app: App, options: { transport: DataTransport }): void {
  app.provide(DATA_TRANSPORT_KEY, options.transport)
  app.component('SchemaPage', SchemaPage)
  app.component('CrudPage', CrudPage)
  app.component('TreePage', TreePage)
}
