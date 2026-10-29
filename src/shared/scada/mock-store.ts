// 组态画面的演示后端：只在 `VITE_API_MODE=mock` 下顶替真实接口。
//
// 契约与 `okmy_dics` 的 `plugins/scada` + `backend/.../scada` 一一对齐，
// 换成真实后端时只改 `VITE_API_MODE=http` 与 `VITE_API_BASE_URL`，页面代码不动。
import type {
  ScadaDocument,
  ScadaPreviewRequest,
  ScadaPreviewResult,
  ScadaScreenDetail,
  ScadaScreenSummary,
  ScadaSymbolLibraryResponse,
  ScadaTagCatalog,
  ScadaTagOption,
  ScadaValidateResult,
} from './types'
import { createEmptyScadaDocument, parseScadaDocument } from './types'
import { SCADA_SYMBOL_VERSION, builtinSymbols, indexSymbols } from './symbols'

/** 未命中该模块路由时的返回值，交给主 mock 继续匹配。 */
export const UNHANDLED = Symbol('scada-mock-unhandled')

interface ScadaMockScreen {
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
}

const STORAGE_KEY = 'micro-admin.scada.v1'

/** 演示通道变量：与本仓库 system 插件的设备无关，仅用于绑定回显。 */
const TAGS: ScadaTagOption[] = [
  {
    tagId: 101, name: '原水箱液位', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / AI12 / 原水箱液位',
    assetNodeId: 1, assetNodeName: 'AI12 模拟量输入', channelType: 'AI', channelNo: 1, physicalName: 'AI1',
    accessMode: 'R', dataTypeName: 'REAL', registerTypeName: '输入寄存器', registerAddress: 0, enabled: true,
    currentValueText: '72.5', qualityCode: 'GOOD', qualityText: '正常',
  },
  {
    tagId: 102, name: '出水压力', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / AI12 / 出水压力',
    assetNodeId: 1, assetNodeName: 'AI12 模拟量输入', channelType: 'AI', channelNo: 2, physicalName: 'AI2',
    accessMode: 'R', dataTypeName: 'REAL', registerTypeName: '输入寄存器', registerAddress: 1, enabled: true,
    currentValueText: '0.42', qualityCode: 'GOOD', qualityText: '正常',
  },
  {
    tagId: 103, name: '1# 泵运行', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / DI24 / 1# 泵运行',
    assetNodeId: 2, assetNodeName: 'DI24 数字量输入', channelType: 'DI', channelNo: 1, physicalName: 'DI1',
    accessMode: 'R', dataTypeName: 'BOOL', registerTypeName: '离散输入', registerAddress: 0, enabled: true,
    currentValueText: '1', qualityCode: 'GOOD', qualityText: '正常',
  },
  {
    tagId: 104, name: '1# 泵启停', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / DO24 / 1# 泵启停',
    assetNodeId: 3, assetNodeName: 'DO24 数字量输出', channelType: 'DO', channelNo: 1, physicalName: 'DO1',
    accessMode: 'RW', dataTypeName: 'BOOL', registerTypeName: '保持寄存器', registerAddress: 0, enabled: true,
    currentValueText: '1', qualityCode: 'GOOD', qualityText: '正常',
  },
]

/** 示例画面：水位 + 泵 + 压力读数，打开就能看出绑定效果。 */
function seedDocument(): ScadaDocument {
  const document = createEmptyScadaDocument()
  document.widgets = [
    {
      id: 'w-title', symbolKey: 'basic.text', name: '标题',
      rect: { x: 40, y: 24, width: 320, height: 36 }, rotation: 'none', zIndex: 1,
      props: { content: '水处理总览', fontSize: 22, color: '#e2e8f0' }, bindings: [], locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-tank', symbolKey: 'vessel.tank', name: '原水箱',
      rect: { x: 80, y: 96, width: 160, height: 220 }, rotation: 'none', zIndex: 2,
      props: { caption: '原水箱' }, bindings: [{ slot: 'level', tagId: 101, tagLabel: '原水箱液位', precision: 1, unit: '%' }],
      locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-line', symbolKey: 'pipe.line-h', name: '出水管道',
      rect: { x: 250, y: 300, width: 240, height: 24 }, rotation: 'none', zIndex: 3,
      props: { thickness: 8 }, bindings: [], locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-pump', symbolKey: 'machine.pump', name: '1# 泵',
      rect: { x: 520, y: 240, width: 140, height: 140 }, rotation: 'none', zIndex: 4,
      props: {}, bindings: [{ slot: 'run', tagId: 103, tagLabel: '1# 泵运行' }], locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-pressure', symbolKey: 'display.value', name: '出水压力',
      rect: { x: 520, y: 96, width: 180, height: 72 }, rotation: 'none', zIndex: 5,
      props: { caption: '出水压力', fontSize: 18 },
      bindings: [{ slot: 'value', tagId: 102, tagLabel: '出水压力', precision: 2, unit: 'MPa' }],
      locked: false, visible: true, groupId: null,
    },
    {
      id: 'w-lamp', symbolKey: 'control.indicator', name: '运行指示',
      rect: { x: 740, y: 96, width: 72, height: 80 }, rotation: 'none', zIndex: 6,
      props: { caption: '运行' }, bindings: [{ slot: 'state', tagId: 103, tagLabel: '1# 泵运行' }],
      locked: false, visible: true, groupId: null,
    },
  ]
  return document
}

interface Store {
  screens: ScadaMockScreen[]
}

function seed(): Store {
  const now = Date.now()
  return {
    screens: [
      {
        id: 1, projectId: 1, name: '水处理总览', description: '原水箱液位、出水压力与泵运行状态',
        documentJson: JSON.stringify(seedDocument()), documentVersion: 1, previewSvg: null,
        sortIndex: 0, createdAt: now, updatedAt: now,
      },
    ],
  }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    // 演示数据损坏时回落到种子，不阻塞页面。
  }
  const store = seed()
  save(store)
  return store
}

function save(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function summary(record: ScadaMockScreen): ScadaScreenSummary {
  const document = parseScadaDocument(record.documentJson)
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    documentVersion: record.documentVersion,
    widgetCount: document.widgets.length,
    sortIndex: record.sortIndex,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function detail(record: ScadaMockScreen): ScadaScreenDetail {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    documentJson: record.documentJson,
    documentVersion: record.documentVersion,
    previewSvg: record.previewSvg,
    sortIndex: record.sortIndex,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** 校验：图元、槽位、变量是否存在；语义与后端 `validate` 保持一致。 */
export function validateDocument(documentJson: string): ScadaValidateResult {
  const document = parseScadaDocument(documentJson)
  const symbols = indexSymbols(builtinSymbols())
  const tagIds = new Set(TAGS.map((tag) => tag.tagId))
  const issues: string[] = []
  const missingTagIds = new Set<number>()

  for (const widget of document.widgets) {
    const symbol = symbols[widget.symbolKey]
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

/**
 * 处理 `/scada/*` 的演示请求。
 *
 * 返回 `UNHANDLED` 表示不属于本模块，主 mock 继续匹配其它路由。
 */
export function handleScadaMock(
  route: string,
  method: string,
  url: URL,
  body: Record<string, unknown>,
): unknown {
  const store = load()
  const projectId = Number(url.searchParams.get('projectId') ?? body.projectId ?? 1) || 1

  if (route === '/scada/symbols' && method === 'GET') {
    const response: ScadaSymbolLibraryResponse = {
      version: SCADA_SYMBOL_VERSION,
      symbols: builtinSymbols(),
      externalSource: null,
    }
    return response
  }

  if (route === '/scada/tags' && method === 'GET') {
    const catalog: ScadaTagCatalog = {
      projectId,
      items: TAGS,
      total: TAGS.length,
      writable: TAGS.filter((tag) => ['W', 'RW', 'WO'].includes(tag.accessMode.toUpperCase())).length,
    }
    return catalog
  }

  if (route === '/scada/screens' && method === 'GET') {
    return store.screens
      .filter((screen) => screen.projectId === projectId)
      .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
      .map(summary)
  }

  if (route === '/scada/screen' && method === 'GET') {
    const screenId = Number(url.searchParams.get('screenId') ?? 0)
    const record = store.screens.find((screen) => screen.id === screenId)
    if (!record) throw Object.assign(new Error('画面不存在'), { status: 404 })
    return detail(record)
  }

  if (route === '/scada/screen/create' && method === 'POST') {
    const name = String(body.name ?? '').trim()
    if (!name) throw Object.assign(new Error('画面名称不能为空'), { status: 400 })
    const now = Date.now()
    const record: ScadaMockScreen = {
      id: Math.max(0, ...store.screens.map((screen) => screen.id)) + 1,
      projectId,
      name,
      description: (body.description as string | null) ?? null,
      documentJson: String(body.documentJson ?? JSON.stringify(createEmptyScadaDocument())),
      documentVersion: 1,
      previewSvg: null,
      sortIndex: store.screens.filter((screen) => screen.projectId === projectId).length,
      createdAt: now,
      updatedAt: now,
    }
    store.screens.push(record)
    save(store)
    return detail(record)
  }

  if (route === '/scada/screen/update' && method === 'POST') {
    const screenId = Number(body.screenId ?? 0)
    const record = store.screens.find((screen) => screen.id === screenId)
    if (!record) throw Object.assign(new Error('画面不存在'), { status: 404 })
    if (typeof body.documentJson === 'string' && body.documentJson.trim()) {
      const report = validateDocument(body.documentJson)
      if (!report.valid) {
        throw Object.assign(new Error(`画面未通过校验：${report.issues.join('；')}`), { status: 400 })
      }
      record.documentJson = body.documentJson
    }
    if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
    if (body.description === null || typeof body.description === 'string') record.description = body.description
    if (typeof body.previewSvg === 'string') record.previewSvg = body.previewSvg
    if (typeof body.documentVersion === 'number') record.documentVersion = body.documentVersion
    if (typeof body.sortIndex === 'number') record.sortIndex = body.sortIndex
    record.updatedAt = Date.now()
    save(store)
    return detail(record)
  }

  if (route === '/scada/screen/delete' && method === 'POST') {
    const screenId = Number(body.screenId ?? 0)
    store.screens = store.screens.filter((screen) => screen.id !== screenId)
    save(store)
    return { deleted: 1 }
  }

  if (route === '/scada/validate' && method === 'POST') {
    return validateDocument(String(body.documentJson ?? ''))
  }

  if (route === '/scada/preview' && method === 'POST') {
    const payload = body as unknown as ScadaPreviewRequest
    const report = validateDocument(String(payload.documentJson ?? ''))
    const result: ScadaPreviewResult = {
      // 浏览器端没有服务端渲染器：这里只回报校验结果，SVG 由画布自身序列化。
      svg: '',
      issues: report.issues,
      missingTagIds: report.missingTagIds,
    }
    return result
  }

  return UNHANDLED
}

/** 演示变量清单，供页面在无后端时直接复用。 */
export function mockScadaTags(): ScadaTagOption[] {
  return structuredClone(TAGS)
}
