// sub2api 网关客户端（Responses API）：全站唯一一份。
//
// 缺参追问、图纸补全、vibeelement 模板生成都走它，不各写一套 HTTP 与轮询。
// 复用网关已有的 Responses 能力（含 `background` 异步任务），因此本仓库不引入任务队列：
// - `background: true` → 拿 id 后轮询 `GET /v1/responses/{id}`，适合慢模型；
// - 网关不支持异步时自动回退同步调用；
// - 没有 key 时调用方拿到 `null`，接口直接报「未启用」，不偷偷发请求。
//
// 密钥只从服务端环境变量读，浏览器永远拿不到。

export interface Sub2apiOptions {
  baseUrl: string
  apiKey: string
  model: string
  /** 优先用 background + 轮询。 */
  background: boolean
  timeoutMs: number
  pollIntervalMs: number
  fetchImpl?: typeof fetch
}

/** 与前端/接口回显的启用状态：不回显密钥。 */
export interface Sub2apiStatus {
  enabled: boolean
  model: string
  /** 网关地址只回显 host。 */
  baseUrl: string
  background: boolean
}

export interface Sub2apiEnvNames {
  /** 模型的环境变量名，如 `EXTRUSION_MODEL` / `UIC_MODEL`。 */
  model: string
  /** 是否启用 background 的环境变量名。 */
  background: string
  /** 超时的环境变量名。 */
  timeout: string
  /** 轮询间隔的环境变量名。 */
  poll: string
  /** 缺省模型名。 */
  defaultModel: string
  defaultTimeoutMs?: number
  defaultPollMs?: number
}

/** 从环境变量装配；缺 `SUB2API_API_KEY` 时返回 `null`（AI 未启用）。 */
export function sub2apiFromEnv(env: NodeJS.ProcessEnv, names: Sub2apiEnvNames): Sub2apiOptions | null {
  const apiKey = (env.SUB2API_API_KEY ?? '').trim()
  if (!apiKey) return null
  return {
    baseUrl: (env.SUB2API_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/+$/, ''),
    apiKey,
    model: (env[names.model] ?? names.defaultModel).trim(),
    background: (env[names.background] ?? '1') !== '0',
    timeoutMs: Number(env[names.timeout] ?? names.defaultTimeoutMs ?? 90_000) || 90_000,
    pollIntervalMs: Number(env[names.poll] ?? names.defaultPollMs ?? 900) || 900,
  }
}

export function sub2apiStatusOf(options: Sub2apiOptions | null): Sub2apiStatus {
  if (!options) return { enabled: false, model: '', baseUrl: '', background: false }
  return { enabled: true, model: options.model, baseUrl: options.baseUrl, background: options.background }
}

/** 发一次 Responses 请求；非 2xx 抛带 `status` 的错误，交给外壳统一翻译。 */
export async function callResponses(
  options: Sub2apiOptions,
  body: Record<string, unknown>,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(`${options.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  })
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message
      ?? `Responses API ${response.status}`
    throw Object.assign(new Error(message), { status: response.status })
  }
  return payload
}

/** 轮询后台任务直到终态或超时。 */
export async function pollResponse(options: Sub2apiOptions, id: string): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const deadline = Date.now() + options.timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs))
    const response = await fetchImpl(`${options.baseUrl}/v1/responses/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const message = (payload as { error?: { message?: string } } | null)?.error?.message
        ?? `Responses API ${response.status}`
      throw Object.assign(new Error(message), { status: response.status })
    }
    last = payload
    const status = String(payload?.status ?? '')
    if (status === 'completed' || status === 'incomplete' || status === 'failed' || status === 'cancelled') {
      return payload
    }
  }
  return last
}

/** 取纯文本：`output_text` 优先，其次拼 `output[].content[].text`。 */
export function textOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text
  const chunks: string[] = []
  const output = Array.isArray(record.output) ? record.output : []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const entry = part as Record<string, unknown>
      if (typeof entry.text === 'string') chunks.push(entry.text)
    }
  }
  return chunks.join('\n')
}

/** 从模型输出里剥出数组：容忍 markdown 代码块与 `{ items: [...] }` 包装。 */
export function parseArrayLoose(text: string, keys: ReadonlyArray<string> = ['items', 'result', 'data']): unknown[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const candidates = [trimmed]
  const arrayStart = trimmed.indexOf('[')
  const arrayEnd = trimmed.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(trimmed.slice(arrayStart, arrayEnd + 1))
  const objectStart = trimmed.indexOf('{')
  const objectEnd = trimmed.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        for (const key of keys) {
          if (Array.isArray(record[key])) return record[key] as unknown[]
        }
      }
    } catch {
      continue
    }
  }
  return []
}

/**
 * 跑一次「问 → 取结构化结果」的完整流程。
 *
 * 统一封装 background 优先 + 同步回退 + 剥 JSON 三段，调用方只提供提示与解析器，
 * 因此新增一类追问（图纸补全、模板生成）不需要再实现一遍轮询。
 */
export async function askForArray(
  options: Sub2apiOptions,
  request: { instruction: string; payload: unknown },
  parse: (raw: unknown) => unknown[],
): Promise<{ items: unknown[]; mode: 'background' | 'sync' }> {
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: request.instruction }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.payload, null, 2) }] },
  ]

  if (options.background) {
    try {
      const created = (await callResponses(options, {
        model: options.model, input, background: true, store: true,
      })) as Record<string, unknown>
      let payload = created
      const id = typeof created.id === 'string' ? created.id : ''
      const status = String(created.status ?? '')
      if (id && status !== 'completed') payload = (await pollResponse(options, id)) as Record<string, unknown>
      const items = parse(parseArrayLoose(textOf(payload)))
      if (items.length) return { items, mode: 'background' }
      // 后台任务没产出内容时退回同步再试一次，避免模型把异步结果写空。
    } catch (error) {
      console.warn('[sub2api] background 调用失败，回退同步：', (error as Error).message)
    }
  }

  const payload = await callResponses(options, { model: options.model, input, store: false })
  return { items: parse(parseArrayLoose(textOf(payload))), mode: 'sync' }
}
