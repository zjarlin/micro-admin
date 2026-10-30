// 图纸插件（服务端）：把共享的图纸包与页面注册表装配成 `UiCanvasService`。
//
// 无状态：图纸存 SQLite（kv），发布写页面注册表，两者都由宿主注入，
// 因此同一份服务代码可以搬到别的项目里复用。
import type { PageRegistry } from '@zjarlin/data-page'
import type { KeyValueStore } from '@zjarlin/ui-server'
import { createUiCanvasService, type UiCanvasService } from './service.ts'
import { sub2apiFromEnv } from '../../lib/sub2api.ts'

export interface UiCanvasPluginOptions {
  kv: KeyValueStore
  /** 页面注册表：必须可写，否则发布接口直接报 403。 */
  registry: PageRegistry
  namespace?: string
  /** 覆盖 AI 配置；缺省从环境变量读（无 key 时 AI 不启用）。 */
  ai?: ReturnType<typeof sub2apiFromEnv>
}

/** 图纸侧读的环境变量：`UIC_MODEL` / `UIC_AI_BACKGROUND` / `UIC_AI_TIMEOUT_MS` / `UIC_AI_POLL_MS`。 */
export function uiCanvasAiFromEnv(env: NodeJS.ProcessEnv = process.env): ReturnType<typeof sub2apiFromEnv> {
  return sub2apiFromEnv(env, {
    model: 'UIC_MODEL',
    background: 'UIC_AI_BACKGROUND',
    timeout: 'UIC_AI_TIMEOUT_MS',
    poll: 'UIC_AI_POLL_MS',
    defaultModel: 'gpt-4.1-mini',
  })
}

export function createUiCanvasPlugin(options: UiCanvasPluginOptions): UiCanvasService {
  return createUiCanvasService({
    kv: options.kv,
    registry: options.registry,
    ai: options.ai ?? uiCanvasAiFromEnv(),
    ...(options.namespace ? { namespace: options.namespace } : {}),
  })
}
