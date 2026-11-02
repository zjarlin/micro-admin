// 图纸插件（服务端）：把共享的图纸包、页面注册表与宿主已有的 AI 客户端装配成 `UiCanvasService`。
//
// 无状态：图纸存 SQLite（kv），发布写页面注册表，两者都由宿主注入，
// 因此同一份服务代码可以搬到别的项目里复用。
//
// AI 不另起一套网关客户端：直接用 `server/plugins/ai` 的配置与 Responses 调用，
// 保证「图纸补参」和「组态指令」走同一个 sub2api、同一份密钥、同一套超时。
import type { PageRegistry } from '@zjarlin/data-page'
import type { KeyValueStore } from '@zjarlin/ui-server'
import { createUiCanvasService, type UiCanvasAiClient, type UiCanvasService } from './service.ts'
import { loadAiConfig } from '../ai/config.ts'
import { respondText } from '../ai/client.ts'

export interface UiCanvasPluginOptions {
  kv: KeyValueStore
  /** 页面注册表：必须可写，否则发布接口直接报 403。 */
  registry: PageRegistry
  namespace?: string
  /** 覆盖 AI 客户端；缺省从环境/Codex 配置读（没配好时 AI 不启用）。 */
  ai?: UiCanvasAiClient | null
}

/** 从模型回复里取一个 JSON 数组：容忍 ```json 围栏与前后解释文字。 */
function extractJsonArray(text: string): unknown[] {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  const body = (fence?.[1] ?? text).trim()
  const parse = (raw: string): unknown[] | null => {
    try {
      const value = JSON.parse(raw) as unknown
      if (Array.isArray(value)) return value
      if (value && typeof value === 'object') {
        // 模型有时会包一层 {"answers": [...]}。
        for (const candidate of Object.values(value as Record<string, unknown>)) {
          if (Array.isArray(candidate)) return candidate
        }
      }
    } catch {
      /* 交给调用方重试 */
    }
    return null
  }
  const direct = parse(body)
  if (direct) return direct
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start >= 0 && end > start) {
    const sliced = parse(body.slice(start, end + 1))
    if (sliced) return sliced
  }
  throw Object.assign(new Error('模型没有返回合法 JSON 数组，可再试一次或在提示词里强调「只输出 JSON 数组」'), { status: 502 })
}

/**
 * 图纸补参用的 AI 客户端。
 *
 * 环境变量与 AI 插件同源（`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`），
 * 只额外允许 `UIC_MODEL` 单独选一个便宜模型，避免图纸补参占掉贵的额度。
 */
export function uiCanvasAiFromEnv(env: NodeJS.ProcessEnv = process.env): UiCanvasAiClient | null {
  const config = loadAiConfig({ env })
  if (!config.ready) return null
  const model = env.UIC_MODEL?.trim() || config.model
  const timeoutMs = Number(env.UIC_AI_TIMEOUT_MS ?? config.timeoutMs) || config.timeoutMs
  return {
    status: { enabled: true, model, baseUrl: config.baseUrl, background: false },
    async ask(instruction, payload) {
      const result = await respondText(
        { ...config, model, timeoutMs },
        {
          instructions: instruction,
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
          maxOutputTokens: 2000,
        },
      )
      return extractJsonArray(result.text)
    },
  }
}

export function createUiCanvasPlugin(options: UiCanvasPluginOptions): UiCanvasService {
  return createUiCanvasService({
    kv: options.kv,
    registry: options.registry,
    ai: options.ai === undefined ? uiCanvasAiFromEnv() : options.ai,
    ...(options.namespace ? { namespace: options.namespace } : {}),
  })
}
