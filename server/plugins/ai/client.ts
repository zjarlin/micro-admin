// 模型调用：走 OpenAI Responses 协议（Codex 用的就是这个 wire_api）。
//
// 这里只做三件事：拼请求、解析文本、把上游错误翻译成可读信息。
// 不重试、不排队——调用方（页面）自己决定要不要再点一次，避免隐式扣费。
import type { AiConfig } from './config.ts'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiTextRequest {
  messages: AiMessage[]
  /** 系统提示词（Responses 的 `instructions`）。 */
  instructions?: string
  maxOutputTokens?: number
  /** 采样温度；部分网关不支持，默认不传。 */
  temperature?: number
}

export interface AiTextResult {
  text: string
  model: string
  usage: Record<string, unknown> | null
}

interface ResponsesItem {
  type?: string
  role?: string
  content?: Array<{ type?: string; text?: string }>
}

function extractText(payload: unknown): string {
  const body = payload as {
    output_text?: unknown
    output?: ResponsesItem[]
  }
  if (typeof body?.output_text === 'string' && body.output_text) return body.output_text
  const parts: string[] = []
  for (const item of body?.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

export async function respondText(config: AiConfig, request: AiTextRequest): Promise<AiTextResult> {
  if (!config.ready) throw Object.assign(new Error('AI 未配置：设置 AI_BASE_URL / AI_API_KEY，或在本机准备好 Codex 配置'), { status: 503 })

  const input = request.messages.map((message) => (
    message.role === 'assistant'
      ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] }
      : { role: 'user', content: [{ type: 'input_text', text: message.content }] }
  ))

  const body: Record<string, unknown> = {
    model: config.model,
    input,
    max_output_tokens: request.maxOutputTokens ?? 1600,
  }
  if (request.instructions) body.instructions = request.instructions
  if (typeof request.temperature === 'number') body.temperature = request.temperature

  const response = await fetch(`${config.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  const text = await response.text()
  if (!response.ok) {
    const message = text.slice(0, 400) || `HTTP ${response.status}`
    throw Object.assign(new Error(`模型调用失败（${response.status}）：${message}`), { status: 502 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw Object.assign(new Error('模型返回的不是 JSON'), { status: 502 })
  }

  return {
    text: extractText(payload),
    model: config.model,
    usage: (payload as { usage?: Record<string, unknown> }).usage ?? null,
  }
}
