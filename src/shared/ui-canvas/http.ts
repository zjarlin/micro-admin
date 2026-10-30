// 图纸页面对后端的调用封装：只在这里出现路径与请求形状。
//
// 与 scada 的 `useService('http')` 同一模式：页面不直接拼 URL，
// 换存储或换前缀时只改这一处。
import type { HttpClient } from '@/shared/http'
import type { UiCompiledPage, UiDiagnostic, UiDrawing, UiQuestion } from './index.ts'

/** 图纸清单项。 */
export interface UiDrawingSummary {
  id: number
  name: string
  description: string | null
  version: number
  publishedKey: string | null
  publishedVersion: number | null
  elementCount: number
  createdAt: number
  updatedAt: number
  sortIndex: number
  title?: string
  roleCounts: Record<string, number>
}

/** 图纸详情。 */
export interface UiDrawingDetail extends UiDrawingSummary {
  drawingJson: string
}

/** 编译结果。 */
export interface UiCompileResponse {
  key: string
  schema: Record<string, unknown>
  diagnostics: UiDiagnostic[]
  questions: UiQuestion[]
  analysis: UiCompiledPage['analysis']
  ai: { enabled: boolean; model: string; baseUrl: string; background: boolean }
  blocked: boolean
}

/** 发布结果。 */
export interface UiPublishResponse {
  key: string
  version: number
  warnings: string[]
  analysis: UiCompiledPage['analysis']
}

/** 缩略图项。 */
export interface UiWireframeItem {
  id: number
  svg: string
  errorCount: number
  warnCount: number
  published: boolean
  columns: number
}

/** AI 补全结果。 */
export interface UiAskResponse {
  applied: number
  skipped: string[]
  questions: UiQuestion[]
  diagnostics?: UiDiagnostic[]
  schema?: Record<string, unknown>
  analysis?: UiCompiledPage['analysis']
  drawingJson?: string
  ai: { enabled: boolean; model: string; called: boolean; mode?: string; answered?: number }
}

export interface UiCanvasApi {
  list(): Promise<UiDrawingSummary[]>
  detail(id: number): Promise<UiDrawingDetail>
  create(payload: { name: string; description?: string; drawingJson?: string }): Promise<UiDrawingDetail>
  update(payload: { id: number; name?: string; description?: string; drawingJson?: string }): Promise<UiDrawingDetail>
  remove(id: number): Promise<{ deleted: number; publishedKey: string | null }>
  compile(payload: { id?: number; drawingJson?: string }): Promise<UiCompileResponse>
  publish(id: number): Promise<UiPublishResponse>
  unpublish(id: number): Promise<{ key: string | null; removed: boolean }>
  ask(id: number): Promise<UiAskResponse>
  wireframes(ids?: number[]): Promise<UiWireframeItem[]>
  /** 单张图纸的 SVG：直接给 `<img src>` 用（带不了 Bearer，所以走 query token 由宿主代理）。 */
  wireframeUrl(id: number, width: number, height: number): string
}

export function createUiCanvasApi(http: HttpClient): UiCanvasApi {
  const post = <T>(path: string, body: unknown): Promise<T> =>
    http.request<T>(path, { method: 'POST', body: JSON.stringify(body) })

  return {
    list: () => http.request<UiDrawingSummary[]>('/ui-canvas/drawings'),
    detail: (id) => http.request<UiDrawingDetail>(`/ui-canvas/drawing?id=${id}`),
    create: (payload) => post<UiDrawingDetail>('/ui-canvas/drawing/create', payload),
    update: (payload) => post<UiDrawingDetail>('/ui-canvas/drawing/update', payload),
    remove: (id) => post('/ui-canvas/drawing/delete', { id }),
    compile: (payload) => post<UiCompileResponse>('/ui-canvas/drawing/compile', payload),
    publish: (id) => post<UiPublishResponse>('/ui-canvas/drawing/publish', { id }),
    unpublish: (id) => post('/ui-canvas/drawing/unpublish', { id }),
    ask: (id) => post<UiAskResponse>('/ui-canvas/drawing/ask', { id }),
    wireframes: (ids) => post<UiWireframeItem[]>('/ui-canvas/drawings/wireframe', ids ? { ids } : {}),
    wireframeUrl: (id, width, height) => `/ui-canvas/drawing/wireframe?id=${id}&width=${width}&height=${height}`,
  }
}

/** 解析图纸 JSON：字段缺失按默认值补齐，与后端 `parseDrawing` 同一语义。 */
export function parseDrawing(raw: string | null | undefined, fallbackKey = 'draft'): UiDrawing {
  const empty: UiDrawing = {
    version: 1,
    meta: { key: fallbackKey, title: '未命名页面', entity: '记录', pageSize: 10 },
    canvas: { width: 1440, height: 920, grid: 20, background: '#f8fafc', showGrid: true },
    elements: [],
  }
  if (!raw || !raw.trim()) return empty
  try {
    const parsed = JSON.parse(raw) as Partial<UiDrawing>
    if (!parsed || typeof parsed !== 'object') return empty
    return {
      version: Number(parsed.version ?? 1) || 1,
      meta: { ...empty.meta, ...(parsed.meta ?? {}) },
      canvas: { ...empty.canvas, ...(parsed.canvas ?? {}) },
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    }
  } catch {
    return empty
  }
}
