// 外壳插件（服务端）：把外壳图纸服务装成宿主的一个扩展。
//
// 无状态：图纸与「已发布外壳」都存 kv（SQLite），由宿主注入，因此这份代码能整体搬走。
import type { KeyValueStore } from '@zjarlin/ui-server'
import { createShellService, type ShellService } from './service.ts'

export interface ShellPluginOptions {
  kv: KeyValueStore
  namespace?: string
}

export function createShellPlugin(options: ShellPluginOptions): ShellService {
  return createShellService({
    kv: options.kv,
    ...(options.namespace ? { namespace: options.namespace } : {}),
  })
}
