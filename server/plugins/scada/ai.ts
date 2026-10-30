// 缺参追问：走 sub2api 网关的 Responses API（实现在 `server/lib/sub2api.ts`）。
//
// 组态→BIM 的规则表（`@zjarlin/ifc-canvas/symbols3d`）覆盖了内置图元，
// 自定义图元才会缺 `depth/elevation/material`。这时把「只含缺失字段」的清单丢给模型，
// 要一份 JSON 决策回来，再把结果写回画面。
//
// 本文件只负责「组态领域的提示词与白名单」；HTTP、background 轮询、JSON 剥壳
// 都在共享客户端里，因此新增一类追问不需要再实现一遍。

import type { AiExtrusionDecision, ExtrusionPlan } from '../../../src/shared/scada/ifc.ts'
import {
  askForArray,
  sub2apiFromEnv,
  sub2apiStatusOf,
  type Sub2apiOptions,
  type Sub2apiStatus,
} from '../../lib/sub2api.ts'

/** 组态侧沿用的名字：配置形状与共享客户端一致。 */
export type ExtrusionAiOptions = Sub2apiOptions
export type ExtrusionAiStatus = Sub2apiStatus

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

export function extrusionAiFromEnv(env: NodeJS.ProcessEnv = process.env): ExtrusionAiOptions | null {
  return sub2apiFromEnv(env, {
    model: 'EXTRUSION_MODEL',
    background: 'EXTRUSION_AI_BACKGROUND',
    timeout: 'EXTRUSION_AI_TIMEOUT_MS',
    poll: 'EXTRUSION_AI_POLL_MS',
    defaultModel: 'gpt-4.1-mini',
  })
}

export function aiStatusOf(options: ExtrusionAiOptions | null): ExtrusionAiStatus {
  return sub2apiStatusOf(options)
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
  const { items, mode } = await askForArray(
    options,
    { instruction: request.instruction, payload: request.items },
    sanitizeDecisions,
  )
  return { decisions: items as AiExtrusionDecision[], mode, model: options.model }
}
