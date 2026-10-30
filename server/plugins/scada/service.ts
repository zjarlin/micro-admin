// 组态画面服务：画面 CRUD、校验、点位目录。
//
// 与 UI 无关，只依赖 SQLite 与共享的 scada 类型/图元库，
// 因此可以整体搬到别的项目里（换存储只改 kv 注入）。
import { RawResponse, type KeyValueStore } from '@zjarlin/ui-server'
import {
  buildPlan,
  renderPlanIsometric,
  renderPlanIsometricFit,
  writeIfc,
  type AiExtrusionDecision,
  type ExtrusionPlan,
} from '../../../src/shared/scada/ifc.ts'
import { aiStatusOf, requestExtrusionDecisions, type ExtrusionAiOptions } from './ai.ts'
import {
  createEmptyScadaDocument,
  parseScadaDocument,
  type ScadaPreviewRequest,
  type ScadaPreviewResult,
  type ScadaScreenDetail,
  type ScadaScreenSummary,
  type ScadaSymbolDefinition,
  type ScadaSymbolLibraryResponse,
  type ScadaTagCatalog,
  type ScadaTagOption,
  type ScadaValidateResult,
} from '../../../src/shared/scada/types.ts'
import { indexSymbols } from '../../../src/shared/scada/symbols.ts'
import { buildPartScene, buildScene, sceneToSvg } from '../../../src/shared/scada/scene.ts'
import type { TagValueSource } from '../../../src/shared/scada/render.ts'

/** 画面存储形状：与对外的 `ScadaScreenDetail` 一致，但只存必要字段。 */
interface StoredScreen {
  id: number
  projectId: number
  name: string
  description: string | null
  documentJson: string
  documentVersion: number
  previewSvg: string | null
  sortIndex: number
  createdAt: number
  updatedAt: number
  /** 3D 拉伸决策（AI/人工确认过的字段覆盖）；null 表示全部走规则表。 */
  extrusionJson: string | null
}

interface ScadaState {
  screens: StoredScreen[]
}

export interface ScadaServiceOptions {
  /** 单例存储：画面清单整体读写（数量级在千以内，整存比逐行映射更简单可靠）。 */
  kv: KeyValueStore
  /** 内置图元库（由调用方读 JSON 后传入，避免在服务层依赖打包器）。 */
  symbols: ScadaSymbolDefinition[]
  symbolVersion: number
  /** 点位目录：演示静态表，换成真实采集通道时替换这里即可。 */
  tags: ScadaTagOption[]
  /** 存储键前缀，便于同库多租户共存。 */
  namespace?: string
  /** 缺参追问的模型配置；缺省表示 AI 未启用（只用规则表）。 */
  ai?: ExtrusionAiOptions | null
}

export interface ScadaService {
  /** 异步：缺参追问要等模型返回，其余分支仍然同步完成。 */
  handle(request: {
    method: string
    path: string
    query: URLSearchParams
    body: Record<string, unknown>
  }): Promise<unknown | typeof UNHANDLED>
}

export const UNHANDLED = Symbol('scada-unhandled')

function errorOf(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/** 校验：图元、槽位、变量是否存在；与前端保存前校验同一语义。 */
export function validateScadaDocument(
  documentJson: string,
  symbols: ScadaSymbolDefinition[],
  tags: ScadaTagOption[],
): ScadaValidateResult {
  const document = parseScadaDocument(documentJson)
  const index = indexSymbols(symbols)
  const tagIds = new Set(tags.map((tag) => tag.tagId))
  const issues: string[] = []
  const missingTagIds = new Set<number>()

  for (const widget of document.widgets) {
    const symbol = index[widget.symbolKey]
    if (!symbol) {
      issues.push(`图元 ${widget.name || widget.id} 的类型 ${widget.symbolKey} 不存在`)
      continue
    }
    for (const binding of widget.bindings) {
      if (!symbol.bindingSlots.some((slot) => slot.key === binding.slot)) {
        issues.push(`图元 ${widget.name || widget.id} 没有绑定槽位 ${binding.slot}`)
      }
      if (!tagIds.has(binding.tagId)) {
        missingTagIds.add(binding.tagId)
        issues.push(`图元 ${widget.name || widget.id} 绑定的变量 ${binding.tagId} 不存在`)
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    missingTagIds: [...missingTagIds],
    referencedTagIds: [...new Set(document.widgets.flatMap((widget) => widget.bindings.map((binding) => binding.tagId)))],
    widgetCount: document.widgets.length,
  }
}

function previewOf(documentJson: string, options: ScadaServiceOptions): string {
  const document = parseScadaDocument(documentJson)
  return renderSvg(document, options.symbols, new Map(), Boolean(document.canvas.showGrid))
}

/**
 * 画面 → SVG 字符串。
 *
 * 与前端 `ScadaSurface` 消费同一个 `buildScene`，所以「预览接口返回的样子」
 * 和编辑器里看到的一致；不再是空字符串。
 */
function renderSvg(
  document: ReturnType<typeof parseScadaDocument>,
  symbols: ScadaSymbolDefinition[],
  values: Map<number, TagValueSource>,
  showGrid: boolean,
): string {
  const scene = buildScene(document, indexSymbols(symbols), values)
  return sceneToSvg({ ...scene, showGrid })
}

function summaryOf(record: StoredScreen): ScadaScreenSummary {
  const document = parseScadaDocument(record.documentJson)
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    documentVersion: record.documentVersion,
    widgetCount: document.widgets.length,
    threeD: Boolean(record.extrusionJson),
    sortIndex: record.sortIndex,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function detailOf(record: StoredScreen): ScadaScreenDetail {
  return { ...record, extrusionJson: record.extrusionJson ?? null }
}

/** 已保存的决策：按 `<widgetId>/<partId>` 存，未知零件自动忽略。 */
function decisionsOf(record: StoredScreen): Record<string, AiExtrusionDecision> {
  if (!record.extrusionJson) return {}
  try {
    const parsed = JSON.parse(record.extrusionJson) as Record<string, AiExtrusionDecision>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 首屏示例：水位 + 泵 + 压力读数，打开就能看出绑定效果。 */
function seedScreens(tags: ScadaTagOption[]): StoredScreen[] {
  const document = createEmptyScadaDocument()
  const tagOf = (id: number): ScadaTagOption | undefined => tags.find((tag) => tag.tagId === id)
  const label = (id: number): string => tagOf(id)?.name ?? ''
  document.widgets = [
    {
      id: 'w-title', symbolKey: 'basic.text', name: '标题',
      rect: { x: 40, y: 24, width: 320, height: 36 }, rotation: 'none', zIndex: 1,
      props: { content: '水处理总览', fontSize: 22, color: '#e2e8f0' }, bindings: [], locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-tank', symbolKey: 'vessel.tank', name: '原水箱',
      rect: { x: 80, y: 96, width: 160, height: 220 }, rotation: 'none', zIndex: 2,
      props: { caption: '原水箱' }, bindings: [{ slot: 'level', tagId: 101, tagLabel: label(101), precision: 1, unit: '%' }],
      locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-pump', symbolKey: 'machine.pump', name: '1# 泵',
      rect: { x: 520, y: 240, width: 140, height: 140 }, rotation: 'none', zIndex: 4,
      props: {}, bindings: [{ slot: 'run', tagId: 103, tagLabel: label(103) }], locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-pressure', symbolKey: 'display.value', name: '出水压力',
      rect: { x: 520, y: 96, width: 180, height: 72 }, rotation: 'none', zIndex: 5,
      props: { caption: '出水压力', fontSize: 18 },
      bindings: [{ slot: 'value', tagId: 102, tagLabel: label(102), precision: 2, unit: 'MPa' }],
      locked: false, visible: true, groupId: null,
    },
  ]
  const now = Date.now()
  return [{
    id: 1, projectId: 1, name: '水处理总览', description: '原水箱液位、出水压力与泵运行状态',
    documentJson: JSON.stringify(document), documentVersion: 1, previewSvg: null,
    sortIndex: 0, createdAt: now, updatedAt: now, extrusionJson: null,
  }]
}

export function createScadaService(options: ScadaServiceOptions): ScadaService {
  const key = `${options.namespace ?? 'scada'}:state`

  function load(): ScadaState {
    const existing = options.kv.get<ScadaState>(key)
    if (existing?.screens) return existing
    const seeded: ScadaState = { screens: seedScreens(options.tags) }
    options.kv.set(key, seeded)
    return seeded
  }

  function save(state: ScadaState): void {
    options.kv.set(key, state)
  }

  return {
    async handle(request): Promise<unknown | typeof UNHANDLED> {
      const { method, path, query } = request
      // GET 没有请求体：统一按空对象处理，避免扩展层各写一遍空值判断。
      const body = (typeof request.body === 'object' && request.body !== null
        ? request.body
        : {}) as Record<string, unknown>
      const projectId = Number(query.get('projectId') ?? body.projectId ?? 1) || 1
      const state = load()

      if (path === '/scada/symbols' && method === 'GET') {
        const response: ScadaSymbolLibraryResponse = {
          version: options.symbolVersion,
          symbols: options.symbols.map((symbol) => structuredClone(symbol)),
          externalSource: null,
        }
        return response
      }

      if (path === '/scada/tags' && method === 'GET') {
        const catalog: ScadaTagCatalog = {
          projectId,
          items: options.tags,
          total: options.tags.length,
          writable: options.tags.filter((tag) => ['W', 'RW', 'WO'].includes(tag.accessMode.toUpperCase())).length,
        }
        return catalog
      }

      if (path === '/scada/screens' && method === 'GET') {
        return state.screens
          .filter((screen) => screen.projectId === projectId)
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map(summaryOf)
      }

      if (path === '/scada/screen' && method === 'GET') {
        const screenId = Number(query.get('screenId') ?? 0)
        const record = state.screens.find((screen) => screen.id === screenId)
        if (!record) throw errorOf('画面不存在', 404)
        return detailOf(record)
      }

      if (path === '/scada/screen/create' && method === 'POST') {
        const name = String(body.name ?? '').trim()
        if (!name) throw errorOf('画面名称不能为空', 400)
        const now = Date.now()
        const documentJson = String(body.documentJson ?? '')
          || JSON.stringify(createEmptyScadaDocument())
        const record: StoredScreen = {
          id: Math.max(0, ...state.screens.map((screen) => screen.id)) + 1,
          projectId,
          name,
          description: typeof body.description === 'string' ? body.description : null,
          documentJson,
          documentVersion: 1,
          previewSvg: previewOf(documentJson, options),
          sortIndex: state.screens.filter((screen) => screen.projectId === projectId).length,
          createdAt: now,
          updatedAt: now,
          extrusionJson: null,
        }
        state.screens.push(record)
        save(state)
        return detailOf(record)
      }

      if (path === '/scada/screen/update' && method === 'POST') {
        const screenId = Number(body.screenId ?? 0)
        const record = state.screens.find((screen) => screen.id === screenId)
        if (!record) throw errorOf('画面不存在', 404)
        if (typeof body.documentJson === 'string' && body.documentJson.trim()) {
          const report = validateScadaDocument(body.documentJson, options.symbols, options.tags)
          if (!report.valid) throw errorOf(`画面未通过校验：${report.issues.join('；')}`, 400)
          record.documentJson = body.documentJson
        }
        if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
        if (body.description === null || typeof body.description === 'string') record.description = body.description
        // 缩略图由服务端生成：客户端传什么都不再是唯一来源，避免「预览图与文档不一致」。
        record.previewSvg = previewOf(record.documentJson, options)
        if (typeof body.documentVersion === 'number') record.documentVersion = body.documentVersion
        if (typeof body.sortIndex === 'number') record.sortIndex = body.sortIndex
        record.updatedAt = Date.now()
        save(state)
        return detailOf(record)
      }

      if (path === '/scada/screen/delete' && method === 'POST') {
        const screenId = Number(body.screenId ?? 0)
        const before = state.screens.length
        state.screens = state.screens.filter((screen) => screen.id !== screenId)
        save(state)
        return { deleted: before - state.screens.length }
      }

      if (path === '/scada/validate' && method === 'POST') {
        return validateScadaDocument(String(body.documentJson ?? ''), options.symbols, options.tags)
      }

      if (path === '/scada/preview' && method === 'POST') {
        const payload = body as unknown as ScadaPreviewRequest
        const report = validateScadaDocument(String(payload.documentJson ?? ''), options.symbols, options.tags)
        const document = parseScadaDocument(String(payload.documentJson ?? ''))
        const values = new Map<number, TagValueSource>()
        for (const value of payload.values ?? []) {
          const source: TagValueSource = {}
          if (value.raw !== undefined) source.raw = value.raw
          if (value.text !== undefined) source.text = value.text
          if (value.quality !== undefined) source.quality = value.quality
          values.set(value.tagId, source)
        }
        const showGrid = typeof payload.showGrid === 'boolean' ? payload.showGrid : Boolean(document.canvas.showGrid)
        const result: ScadaPreviewResult = {
          // 服务端与编辑器共用 shared/scada/scene 的求值结果，只是这里序列化成字符串。
          svg: renderSvg(document, options.symbols, values, showGrid),
          issues: report.issues,
          missingTagIds: report.missingTagIds,
        }
        return result
      }

      // ---------------- IFC / 3D（2D→BIM） ----------------

      if (path === '/scada/screen/extrusion/plan' && method === 'POST') {
        const record = requireScreen(state, Number(body.screenId ?? 0))
        const projection = projectionOf(body)
        const plan = planOf(record, options, projection, decisionsOf(record))
        return planResponse(record, plan, options)
      }

      if (path === '/scada/screen/extrusion/apply' && method === 'POST') {
        const record = requireScreen(state, Number(body.screenId ?? 0))
        const decisions = Array.isArray(body.decisions) ? (body.decisions as AiExtrusionDecision[]) : []
        if (decisions.length) {
          const merged = { ...decisionsOf(record) }
          for (const decision of decisions) {
            if (decision && typeof decision.key === 'string' && decision.key) merged[decision.key] = decision
          }
          record.extrusionJson = JSON.stringify(merged)
          record.updatedAt = Date.now()
          save(state)
        }
        const plan = planOf(record, options, projectionOf(body), decisionsOf(record))
        return planResponse(record, plan, options)
      }

      if (path === '/scada/screen/extrusion/ai' && method === 'POST') {
        if (!options.ai) throw errorOf('AI 未启用：缺少 SUB2API_API_KEY', 400)
        const record = requireScreen(state, Number(body.screenId ?? 0))
        const projection = projectionOf(body)
        const before = planOf(record, options, projection, decisionsOf(record))
        if (!before.aiRequest) {
          return { ...planResponse(record, before, options), ai: { ...aiStatusOf(options.ai), called: false } }
        }
        const result = await requestExtrusionDecisions(before, options.ai)
        const merged = { ...decisionsOf(record) }
        for (const decision of result.decisions) merged[decision.key] = decision
        record.extrusionJson = JSON.stringify(merged)
        record.updatedAt = Date.now()
        save(state)
        const after = planOf(record, options, projection, decisionsOf(record))
        return {
          ...planResponse(record, after, options),
          ai: { ...aiStatusOf(options.ai), called: true, mode: result.mode, model: result.model, answered: result.decisions.length },
        }
      }

      if (path === '/scada/screens/iso' && method === 'POST') {
        // 九宫格缩略图：一次拿整页，避免每张卡片单独发请求（浏览器 <img> 带不了 Bearer）。
        const ids = Array.isArray(body.screenIds) ? body.screenIds.map(Number) : null
        const projection = projectionOf(body)
        return state.screens
          .filter((screen) => screen.projectId === projectId && (!ids || ids.includes(screen.id)))
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map((screen) => {
            const plan = planOf(screen, options, projection, decisionsOf(screen))
            // 缩略图按内容自适应：画面常常只占画布一角，固定比例会只看得到一块空墙。
            const iso = renderPlanIsometricFit(plan, { width: 320, height: 240 }, { background: null, labels: false })
            return { id: screen.id, svg: iso.svg, width: iso.width, height: iso.height, threeD: Boolean(screen.extrusionJson) }
          })
      }

      if (path === '/scada/screen/ifc' && method === 'GET') {
        const record = requireScreen(state, Number(query.get('screenId') ?? 0))
        const projection = query.get('projection') === 'plan' ? 'plan' : 'facade'
        const plan = planOf(record, options, projection, decisionsOf(record))
        const file = writeIfc(plan, {
          name: record.name,
          screenId: record.id,
          projectId: record.projectId,
          documentVersion: record.documentVersion,
          organization: 'Micro Admin',
          author: 'micro-admin',
        })
        return new RawResponse(file.content, 'application/x-step', { filename: file.filename })
      }

      if (path === '/scada/screen/iso' && method === 'GET') {
        const record = requireScreen(state, Number(query.get('screenId') ?? 0))
        const projection = query.get('projection') === 'plan' ? 'plan' : 'facade'
        const scale = Math.min(Math.max(Number(query.get('scale') ?? 0.16) || 0.16, 0.02), 1)
        const plan = planOf(record, options, projection, decisionsOf(record))
        const iso = renderPlanIsometric(plan, { scale, background: null, labels: false })
        return new RawResponse(iso.svg, 'image/svg+xml; charset=utf-8', { inline: true })
      }

      return UNHANDLED
    },
  }
}

function requireScreen(state: ScadaState, screenId: number): StoredScreen {
  const record = state.screens.find((screen) => screen.id === screenId)
  if (!record) throw errorOf('画面不存在', 404)
  return record
}

function projectionOf(body: Record<string, unknown>): 'facade' | 'plan' {
  return body.projection === 'plan' ? 'plan' : 'facade'
}

/** 画面 → 零件场景 → 3D 计划；导出与预览共用同一条链路。 */
function planOf(
  record: StoredScreen,
  options: ScadaServiceOptions,
  projection: 'facade' | 'plan',
  decisions: Record<string, AiExtrusionDecision>,
): ExtrusionPlan {
  const document = parseScadaDocument(record.documentJson)
  const scene = buildPartScene(document, indexSymbols(options.symbols), new Map())
  return buildPlan(
    { width: scene.width, height: scene.height, background: scene.background, widgets: scene.widgets },
    {
      screenName: record.name,
      symbols: options.symbols,
      settings: { projection },
      decisions,
    },
  )
}

/** 计划 → 接口响应：前端只拿展示需要的字段，几何留在服务端。 */
function planResponse(
  record: StoredScreen,
  plan: ExtrusionPlan,
  options: ScadaServiceOptions,
): Record<string, unknown> {
  return {
    screenId: record.id,
    screenName: record.name,
    projection: plan.settings.projection,
    canvas: plan.canvas,
    settings: plan.settings,
    stats: plan.stats,
    missing: plan.missing,
    ready: plan.missing.length === 0,
    ai: aiStatusOf(options.ai ?? null),
    items: plan.items.map((item) => ({
      key: `${item.widgetId}/${item.partId}`,
      widgetId: item.widgetId,
      widgetName: item.widgetName,
      symbolKey: item.symbolKey,
      partId: item.partId,
      shape: item.shape,
      text: item.text,
      missing: item.missing,
      hint: item.hint,
      decision: item.decision,
    })),
    aiRequest: plan.aiRequest ? plan.aiRequest.items : null,
  }
}
