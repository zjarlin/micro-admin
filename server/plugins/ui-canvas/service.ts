// 图纸服务：图纸 CRUD、编译、发布、AI 补全与缩略图。
//
// 与 UI 无关，只依赖 SQLite（kv）、共享的图纸包与页面注册表，因此可以整体搬走。
//
// 「画完即上线」在这里闭环：发布 = 编译 → `registry.upsert(key, schema)`，
// 前端下一次拉 `/ui/pages` 就自动多出路由与菜单，不需要发版。

import type { PageRegistry } from '@zjarlin/data-page'
import { RawResponse, type KeyValueStore } from '@zjarlin/ui-server'
import {
  compileDrawing,
  createEmptyDrawing,
  inspectCode,
  renderWireframe,
  validateDrawingVibe,
  type UiCompiledPage,
  type UiDiagnostic,
  type UiDrawing,
  type UiQuestion,
} from '../../../packages/ui-canvas/src/index.ts'
import { seedDrawings } from './seed.ts'
import {
  askForArray,
  sub2apiStatusOf,
  type Sub2apiOptions,
} from '../../lib/sub2api.ts'

interface StoredDrawing {
  id: number
  name: string
  description: string | null
  /** 图纸文档 JSON 原文，前端用 `parseDrawing` 解析。 */
  drawingJson: string
  version: number
  /** 最近一次发布的页面 key（null 表示只存了图纸、没发布）。 */
  publishedKey: string | null
  /** 最近一次发布的页面 schema 版本。 */
  publishedVersion: number | null
  sortIndex: number
  createdAt: number
  updatedAt: number
}

interface UiCanvasState {
  drawings: StoredDrawing[]
  /** 已发布过的 key，用于「下线」时知道该删哪一页。 */
  nextId: number
}

export interface UiCanvasServiceOptions {
  kv: KeyValueStore
  /** 页面注册表：发布就是把编译结果 upsert 进去。 */
  registry: PageRegistry
  namespace?: string
  /** AI 补全配置；null / 缺省表示未启用（只用规则表 + 手工填）。 */
  ai?: Sub2apiOptions | null | undefined
}

export interface UiCanvasService {
  handle(request: {
    method: string
    path: string
    query: URLSearchParams
    body: Record<string, unknown>
  }): Promise<unknown | typeof UNHANDLED>
}

export const UNHANDLED = Symbol('ui-canvas-unhandled')

function errorOf(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/** 图纸 JSON → 文档：字段缺失按默认值补齐，避免老图纸把设计器打挂。 */
export function parseDrawing(raw: string | null | undefined, fallbackKey = 'system.demo'): UiDrawing {
  if (!raw || !raw.trim()) return createEmptyDrawing(fallbackKey)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return createEmptyDrawing(fallbackKey)
  }
  if (!parsed || typeof parsed !== 'object') return createEmptyDrawing(fallbackKey)
  const record = parsed as Partial<UiDrawing>
  const base = createEmptyDrawing(record.meta?.key ?? fallbackKey)
  return {
    version: Number(record.version ?? 1) || 1,
    meta: { ...base.meta, ...(record.meta ?? {}) },
    canvas: { ...base.canvas, ...(record.canvas ?? {}) },
    elements: Array.isArray(record.elements)
      ? record.elements.map((element, index) => normalizeElement(element, index))
      : [],
  }
}

function normalizeElement(raw: unknown, index: number) {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rect = (record.rect && typeof record.rect === 'object' ? record.rect : {}) as Record<string, unknown>
  return {
    id: String(record.id ?? `el-${index + 1}`),
    role: (typeof record.role === 'string' ? record.role : 'text') as UiDrawing['elements'][number]['role'],
    rect: {
      x: Number(rect.x ?? 0) || 0,
      y: Number(rect.y ?? 0) || 0,
      width: Number(rect.width ?? 120) || 120,
      height: Number(rect.height ?? 32) || 32,
    },
    zIndex: Number(record.zIndex ?? index) || 0,
    text: String(record.text ?? ''),
    props: (record.props && typeof record.props === 'object' ? record.props : {}) as Record<string, never>,
    bindings: Array.isArray(record.bindings) ? (record.bindings as never[]) : [],
    locked: Boolean(record.locked),
    visible: record.visible !== false,
  }
}

function summaryOf(record: StoredDrawing): Record<string, unknown> {
  const drawing = parseDrawing(record.drawingJson)
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    publishedKey: record.publishedKey,
    publishedVersion: record.publishedVersion,
    elementCount: drawing.elements.length,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    sortIndex: record.sortIndex,
    title: drawing.meta.title,
    roleCounts: drawing.elements.reduce<Record<string, number>>((acc, element) => {
      acc[element.role] = (acc[element.role] ?? 0) + 1
      return acc
    }, {}),
  }
}

function detailOf(record: StoredDrawing): Record<string, unknown> {
  return { ...summaryOf(record), drawingJson: record.drawingJson }
}

/** AI 只回填缺失字段：白名单外的一律丢掉，避免脏数据写进图纸。 */
export function applyAnswers(
  drawing: UiDrawing,
  answers: ReadonlyArray<{ questionId: string; value: unknown; elementId?: string; field?: string }>,
  questions: UiQuestion[],
): { drawing: UiDrawing; applied: number; skipped: string[] } {
  const byId = new Map(questions.map((question) => [question.id, question]))
  const elements = drawing.elements.map((element) => ({ ...element, props: { ...element.props } }))
  const meta = { ...drawing.meta }
  let applied = 0
  const skipped: string[] = []

  for (const answer of answers) {
    const question = byId.get(answer.questionId)
    if (!question) {
      skipped.push(answer.questionId)
      continue
    }
    // meta 层的追问：key / title / endpoint 直接写回页面元信息。
    if (!question.elementId) {
      if (question.field === 'key' && typeof answer.value === 'string') meta.key = answer.value
      else if (question.field === 'title' && typeof answer.value === 'string') meta.title = answer.value
      else if (question.field === 'endpoint' && typeof answer.value === 'string') meta.endpoint = answer.value
      else {
        skipped.push(answer.questionId)
        continue
      }
      applied += 1
      continue
    }
    const element = elements.find((item) => item.id === question.elementId)
    if (!element) {
      skipped.push(answer.questionId)
      continue
    }
    if (question.field === 'text') {
      element.text = String(answer.value ?? '')
      applied += 1
      continue
    }
    const props = element.props as Record<string, unknown>
    props[question.field] = coerce(question, answer.value)
    applied += 1
  }

  return { drawing: { ...drawing, meta, elements }, applied, skipped }
}

/** 按追问声明的类型收敛模型回填值：形状不对就丢掉，而不是写进图纸。 */
function coerce(question: UiQuestion, value: unknown): unknown {
  if (value === null || value === undefined) return ''
  if (question.kind === 'boolean') return value === true || value === 'true' || value === 1
  if (question.kind === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (question.kind === 'choice' && question.choices?.length) {
    const text = String(value)
    return question.choices.includes(text) ? text : question.choices[0]
  }
  // text 但字段是结构化（options / request / resolveFrom）时，接受模型给的 JSON。
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
  return typeof value === 'object' ? value : String(value)
}

/** 编译 + vibeelement 校验：诊断合并成一份，前端只需渲染一套。 */
export function diagnose(drawing: UiDrawing): { compiled: UiCompiledPage; diagnostics: UiDiagnostic[] } {
  const compiled = compileDrawing(drawing)
  const diagnostics = [...compiled.diagnostics]
  for (const entry of validateDrawingVibe(drawing.elements)) {
    for (const issue of entry.issues) {
      diagnostics.push({
        level: 'level' in issue ? issue.level : 'error',
        code: 'vibe-binding',
        elementId: entry.elementId,
        message: issue.message,
      })
    }
  }
  for (const element of drawing.elements) {
    const code = String((element.props as { code?: string }).code ?? '')
    for (const issue of inspectCode(code)) {
      diagnostics.push({ level: issue.level, code: 'vibe-code', elementId: element.id, message: issue.message })
    }
  }
  return { compiled, diagnostics }
}

export function createUiCanvasService(options: UiCanvasServiceOptions): UiCanvasService {
  const ai = options.ai ?? null
  const key = `${options.namespace ?? 'ui-canvas'}:state`

  function load(): UiCanvasState {
    const existing = options.kv.get<UiCanvasState>(key)
    if (existing?.drawings) return existing
    const seeded: UiCanvasState = { drawings: seedDrawings(), nextId: 1 + seedDrawings().length }
    options.kv.set(key, seeded)
    return seeded
  }

  function save(state: UiCanvasState): void {
    options.kv.set(key, state)
  }

  function requireDrawing(state: UiCanvasState, id: number): StoredDrawing {
    const record = state.drawings.find((item) => item.id === id)
    if (!record) throw errorOf('图纸不存在', 404)
    return record
  }

  return {
    async handle(request): Promise<unknown | typeof UNHANDLED> {
      const { method, path, query } = request
      const body = (typeof request.body === 'object' && request.body !== null
        ? request.body
        : {}) as Record<string, unknown>
      const state = load()

      // ---------------- 图纸 CRUD ----------------

      if (path === '/ui-canvas/drawings' && method === 'GET') {
        return state.drawings
          .slice()
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map(summaryOf)
      }

      if (path === '/ui-canvas/drawing' && method === 'GET') {
        return detailOf(requireDrawing(state, Number(query.get('id') ?? 0)))
      }

      if (path === '/ui-canvas/drawing/create' && method === 'POST') {
        const name = String(body.name ?? '').trim()
        if (!name) throw errorOf('图纸名称不能为空', 400)
        const drawing = typeof body.drawingJson === 'string' && body.drawingJson.trim()
          ? parseDrawing(body.drawingJson, `draft.${state.nextId}`)
          : createEmptyDrawing(`draft.${state.nextId}`, name)
        const now = Date.now()
        const record: StoredDrawing = {
          id: state.nextId,
          name,
          description: typeof body.description === 'string' ? body.description : null,
          drawingJson: JSON.stringify(drawing),
          version: 1,
          publishedKey: null,
          publishedVersion: null,
          sortIndex: state.drawings.length,
          createdAt: now,
          updatedAt: now,
        }
        state.nextId += 1
        state.drawings.push(record)
        save(state)
        return detailOf(record)
      }

      if (path === '/ui-canvas/drawing/update' && method === 'POST') {
        const record = requireDrawing(state, Number(body.id ?? 0))
        if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
        if (typeof body.description === 'string') record.description = body.description
        if (typeof body.drawingJson === 'string' && body.drawingJson.trim()) {
          record.drawingJson = JSON.stringify(parseDrawing(body.drawingJson))
        }
        record.version += 1
        record.updatedAt = Date.now()
        save(state)
        return detailOf(record)
      }

      if (path === '/ui-canvas/drawing/delete' && method === 'POST') {
        const record = requireDrawing(state, Number(body.id ?? 0))
        // 已发布的页面不跟着删：下线是显式动作，避免「删了图纸、页面上还挂着旧路由」。
        state.drawings = state.drawings.filter((item) => item.id !== record.id)
        save(state)
        return { deleted: record.id, publishedKey: record.publishedKey }
      }

      // ---------------- 编译 / 诊断 ----------------

      if (path === '/ui-canvas/drawing/compile' && method === 'POST') {
        const raw = typeof body.drawingJson === 'string' ? body.drawingJson : ''
        const drawing = raw.trim()
          ? parseDrawing(raw)
          : parseDrawing(requireDrawing(state, Number(body.id ?? 0)).drawingJson)
        const { compiled, diagnostics } = diagnose(drawing)
        return {
          key: compiled.key,
          schema: compiled.schema,
          diagnostics,
          questions: compiled.questions,
          analysis: compiled.analysis,
          ai: sub2apiStatusOf(ai),
          blocked: diagnostics.some((item) => item.level === 'error'),
        }
      }

      // ---------------- 发布 / 下线 ----------------

      if (path === '/ui-canvas/drawing/publish' && method === 'POST') {
        if (!options.registry.writable) throw errorOf('页面注册表只读，无法发布图纸', 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        const drawing = parseDrawing(record.drawingJson, record.name)
        const { compiled, diagnostics } = diagnose(drawing)
        const errors = diagnostics.filter((item) => item.level === 'error')
        if (errors.length) {
          throw errorOf(`图纸还有 ${errors.length} 处错误，先修好再发布：${errors.map((item) => item.message).join('；')}`, 400)
        }
        if (!compiled.key?.trim()) throw errorOf('图纸缺少页面 key，无法发布', 400)
        const version = options.registry.upsert(compiled.key, compiled.schema as never)
        record.publishedKey = compiled.key
        record.publishedVersion = version
        record.updatedAt = Date.now()
        save(state)
        return {
          key: compiled.key,
          version,
          warnings: diagnostics.filter((item) => item.level !== 'error').map((item) => item.message),
          analysis: compiled.analysis,
        }
      }

      if (path === '/ui-canvas/drawing/unpublish' && method === 'POST') {
        if (!options.registry.writable) throw errorOf('页面注册表只读，无法下线图纸', 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        const key = record.publishedKey
        if (!key) return { key: null, removed: false }
        options.registry.remove(key)
        record.publishedKey = null
        record.publishedVersion = null
        record.updatedAt = Date.now()
        save(state)
        return { key, removed: true }
      }

      // ---------------- AI 补全 ----------------

      if (path === '/ui-canvas/drawing/ask' && method === 'POST') {
        if (!ai) throw errorOf('AI 未启用：缺少 SUB2API_API_KEY', 400)
        const record = requireDrawing(state, Number(body.id ?? 0))
        const drawing = parseDrawing(record.drawingJson, record.name)
        const { compiled } = diagnose(drawing)
        if (!compiled.questions.length) {
          return { applied: 0, skipped: [], questions: [], ai: { ...sub2apiStatusOf(ai), called: false }, schema: compiled.schema }
        }
        const instruction = [
          '你是后台管理系统的页面配置助手。下面是一份「图纸 → 页面」编译时发现的缺失字段清单。',
          '请只回填这些字段，输出 JSON 数组，每项形如 {"questionId": "...", "value": ...}。',
          'value 的类型按 kind 给：text 给字符串；number 给数字；boolean 给布尔；choice 只能从 choices 里选。',
          'options / request / resolveFrom 这类结构化字段直接给对象或数组，不要写成字符串。',
          '字段名必须是英文驼峰，中文只出现在 label。不要编造接口路径以外的东西。',
        ].join('\n')
        const { items, mode } = await askForArray(
          ai,
          { instruction, payload: compiled.questions },
          (raw) => (Array.isArray(raw) ? raw : []),
        )
        const answers = items
          .filter((item): item is { questionId: string; value: unknown } =>
            Boolean(item) && typeof item === 'object' && typeof (item as { questionId?: unknown }).questionId === 'string')
        const result = applyAnswers(drawing, answers, compiled.questions)
        record.drawingJson = JSON.stringify(result.drawing)
        record.version += 1
        record.updatedAt = Date.now()
        save(state)
        const after = diagnose(result.drawing)
        return {
          applied: result.applied,
          skipped: result.skipped,
          questions: after.compiled.questions,
          diagnostics: after.diagnostics,
          schema: after.compiled.schema,
          analysis: after.compiled.analysis,
          drawingJson: record.drawingJson,
          ai: { ...sub2apiStatusOf(ai), called: true, mode, answered: result.applied },
        }
      }

      // ---------------- 缩略图 ----------------

      if (path === '/ui-canvas/drawings/wireframe' && method === 'POST') {
        // 九宫格一次拿整页：浏览器 <img> 带不了 Bearer，所以由后端批量出 SVG。
        const ids = Array.isArray(body.ids) ? body.ids.map(Number) : null
        return state.drawings
          .filter((record) => !ids || ids.includes(record.id))
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map((record) => {
            const drawing = parseDrawing(record.drawingJson)
            const { compiled, diagnostics } = diagnose(drawing)
            return {
              id: record.id,
              svg: renderWireframe(drawing, { maxWidth: 320, maxHeight: 240 }),
              errorCount: diagnostics.filter((item) => item.level === 'error').length,
              warnCount: diagnostics.filter((item) => item.level === 'warn').length,
              published: Boolean(record.publishedKey),
              columns: compiled.analysis.columns.length,
            }
          })
      }

      if (path === '/ui-canvas/drawing/wireframe' && method === 'GET') {
        const record = requireDrawing(state, Number(query.get('id') ?? 0))
        const scale = Math.min(Math.max(Number(query.get('scale') ?? 0) || 0, 0), 1)
        const svg = renderWireframe(parseDrawing(record.drawingJson), {
          ...(scale > 0 ? { scale } : {}),
          ...(scale > 0 ? {} : { maxWidth: Number(query.get('width') ?? 1280) || 1280, maxHeight: Number(query.get('height') ?? 0) || 0 }),
        })
        return new RawResponse(svg, 'image/svg+xml; charset=utf-8', { inline: true })
      }

      return UNHANDLED
    },
  }
}
