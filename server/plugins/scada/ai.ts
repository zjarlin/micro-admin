// 缺参追问：走 sub2api 网关的 Responses API。
//
// 组态→BIM 的规则表（`@zjarlin/ifc-canvas/symbols3d`）覆盖了内置图元，
// 自定义图元才会缺 `depth/elevation/material`。这时把「只含缺失字段」的清单丢给模型，
// 要一份 JSON 决策回来，再把结果写回画面。
//
// 复用网关已有的 Responses 能力（含 background 异步轮询），不另造一套任务队列：
// - `background: true` 时按 `GET /v1/responses/{id}` 轮询，适合慢模型；
// - 网关不支持异步时自动回退同步调用；
// - 未配置 `SUB2API_API_KEY` 时 `enabled=false`，接口直接报「未启用」，不偷偷发请求。
//
// 密钥只从服务端环境变量读，浏览器永远拿不到。

import type { AiExtrusionDecision, ExtrusionPlan } from '../../../src/shared/scada/ifc.ts'

export interface ExtrusionAiOptions {
  baseUrl: string
  apiKey: string
  model: string
  /** 优先用 background + 轮询。 */
  background: boolean
  timeoutMs: number
  pollIntervalMs: number
  fetchImpl?: typeof fetch
}

export interface ExtrusionAiStatus {
  enabled: boolean
  model: string
  /** 网关地址只回显 host，不回显密钥。 */
  baseUrl: string
  background: boolean
}

const ROLES = ['structure', 'panel', 'instrument', 'machine', 'vessel', 'pipe', 'label'] as const
const FORMS = ['extrude', 'cylinder', 'shell', 'pipe', 'decal', 'skip'] as const
const MATERIALS = ['concrete', 'steel', 'stainless', 'glass', 'plastic', 'paint', 'liquid', 'none'] as const

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 只保留白名单取值：模型多给的字段一律丢掉，避免脏数据写进画面。 */
export function sanitizeDecisions(raw: unknown): AiExtrusionDecision[] {
  if (!Array.isArray(raw)) return []
  const out: AiExtrusionDecision[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const key = String(record.key ?? '').trim()
    if (!key) continue
    const decision: AiExtrusionDecision = { key }
    const role = String(record.role ?? '') as (typeof ROLES)[number]
    if (ROLES.includes(role)) decision.role = role
    const form = String(record.form ?? '') as (typeof FORMS)[number]
    if (FORMS.includes(form)) decision.form = form
    const material = String(record.material ?? '') as (typeof MATERIALS)[number]
    if (MATERIALS.includes(material)) decision.material = material
    const depth = num(record.depth)
    if (depth !== null && depth >= 0 && depth <= 100000) decision.depth = Math.round(depth * 10) / 10
    const elevation = num(record.elevation)
    if (elevation !== null && elevation >= 0 && elevation <= 100000) decision.elevation = Math.round(elevation * 10) / 10
    out.push(decision)
  }
  return out
}

/** 从 Responses 结果里取纯文本：`output_text` 优先，其次拼 `output[].content[].text`。 */
function textOf(payload: unknown): string {
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

/** 模型有时会包一层 markdown 或 `{"decisions": [...]}`，这里统一剥出来。 */
export function parseDecisionJson(text: string): unknown {
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
        for (const key of ['decisions', 'items', 'result']) {
          if (Array.isArray(record[key])) return record[key]
        }
      }
    } catch {
      continue
    }
  }
  return []
}

export function extrusionAiFromEnv(env: NodeJS.ProcessEnv = process.env): ExtrusionAiOptions | null {
  const apiKey = (env.SUB2API_API_KEY ?? '').trim()
  if (!apiKey) return null
  const baseUrl = (env.SUB2API_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/+$/, '')
  return {
    baseUrl,
    apiKey,
    model: (env.EXTRUSION_MODEL ?? 'gpt-4.1-mini').trim(),
    background: (env.EXTRUSION_AI_BACKGROUND ?? '1') !== '0',
    timeoutMs: Number(env.EXTRUSION_AI_TIMEOUT_MS ?? 90_000) || 90_000,
    pollIntervalMs: Number(env.EXTRUSION_AI_POLL_MS ?? 900) || 900,
  }
}

export function aiStatusOf(options: ExtrusionAiOptions | null): ExtrusionAiStatus {
  if (!options) return { enabled: false, model: '', baseUrl: '', background: false }
  return { enabled: true, model: options.model, baseUrl: options.baseUrl, background: options.background }
}

async function callResponses(
  options: ExtrusionAiOptions,
  body: Record<string, unknown>,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(`${options.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  })
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message ?? `Responses API ${response.status}`
    throw Object.assign(new Error(message), { status: response.status })
  }
  return payload
}

async function pollResponse(options: ExtrusionAiOptions, id: string): Promise<unknown> {
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
      const message = (payload as { error?: { message?: string } } | null)?.error?.message ?? `Responses API ${response.status}`
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

/**
 * 只把「缺字段」的零件发给模型，返回可直接写回画面的决策。
 *
 * 计划里没有缺口时不会发请求（`aiRequest === null`），调用方也不该调用这里。
 */
export async function requestExtrusionDecisions(
  plan: ExtrusionPlan,
  options: ExtrusionAiOptions,
): Promise<{ decisions: AiExtrusionDecision[]; mode: 'background' | 'sync'; model: string }> {
  const request = plan.aiRequest
  if (!request) return { decisions: [], mode: 'sync', model: options.model }

  const input = [
    { role: 'system', content: [{ type: 'input_text', text: request.instruction }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.items, null, 2) }] },
  ]

  if (options.background) {
    try {
      const created = (await callResponses(options, {
        model: options.model,
        input,
        background: true,
        store: true,
      })) as Record<string, unknown>
      let payload = created
      const id = typeof created.id === 'string' ? created.id : ''
      const status = String(created.status ?? '')
      if (id && status !== 'completed') payload = (await pollResponse(options, id)) as Record<string, unknown>
      const decisions = sanitizeDecisions(parseDecisionJson(textOf(payload)))
      if (decisions.length) return { decisions, mode: 'background', model: options.model }
      // 后台任务没有产出内容时退回同步再试一次，避免模型把异步结果写空。
    } catch (error) {
      console.warn('[scada][ai] background 调用失败，回退同步：', (error as Error).message)
    }
  }

  const payload = await callResponses(options, { model: options.model, input, store: false })
  return { decisions: sanitizeDecisions(parseDecisionJson(textOf(payload))), mode: 'sync', model: options.model }
}
