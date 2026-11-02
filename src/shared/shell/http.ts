// 外壳对后端的调用封装：只在这里出现路径与请求形状。
//
// 与 `@/shared/ui-canvas/http` 同一模式：页面/外壳不直接拼 URL。
import type { HttpClient } from '@/shared/http'
import type { UiDiagnostic } from '@/shared/ui-canvas'
import type { ShellAnalysis, ShellSchema } from './index.ts'

/** 外壳图纸清单项。 */
export interface ShellDrawingSummary {
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

/** 外壳图纸详情。 */
export interface ShellDrawingDetail extends ShellDrawingSummary {
  drawingJson: string
}

/** 编译结果。 */
export interface ShellCompileResponse {
  key: string
  schema: ShellSchema
  diagnostics: UiDiagnostic[]
  analysis: ShellAnalysis
  blocked: boolean
}

/** 发布结果。 */
export interface ShellPublishResponse {
  key: string
  version: number
  warnings: string[]
  analysis: ShellAnalysis
}

/** 运行期外壳配置（公开读，登录页也读）。 */
export interface ShellRuntimeConfig {
  shell: ShellSchema | null
  version: number
  key: string | null
}

/** 外壳图纸缩略图项（服务端出的线框 SVG）。 */
export interface ShellWireframeItem {
  id: number
  svg: string
  errorCount: number
  warnCount: number
  published: boolean
}

export interface ShellApi {
  list(): Promise<ShellDrawingSummary[]>
  detail(id: number): Promise<ShellDrawingDetail>
  create(payload: { name: string; description?: string; drawingJson?: string }): Promise<ShellDrawingDetail>
  update(payload: { id: number; name?: string; description?: string; drawingJson?: string }): Promise<ShellDrawingDetail>
  remove(id: number): Promise<{ deleted: number; publishedKey: string | null }>
  compile(payload: { id?: number; drawingJson?: string }): Promise<ShellCompileResponse>
  publish(id: number): Promise<ShellPublishResponse>
  unpublish(id: number): Promise<{ key: string | null; removed: boolean }>
  /** 运行期外壳（免登录可读）。 */
  runtime(): Promise<ShellRuntimeConfig>
  wireframes(ids?: number[]): Promise<ShellWireframeItem[]>
  wireframeUrl(id: number, width: number, height: number): string
}

export function createShellApi(http: HttpClient): ShellApi {
  const post = <T>(path: string, body: unknown): Promise<T> =>
    http.request<T>(path, { method: 'POST', body: JSON.stringify(body) })

  return {
    list: () => http.request<ShellDrawingSummary[]>('/shell/drawings'),
    detail: (id) => http.request<ShellDrawingDetail>(`/shell/drawing?id=${id}`),
    create: (payload) => post<ShellDrawingDetail>('/shell/drawing/create', payload),
    update: (payload) => post<ShellDrawingDetail>('/shell/drawing/update', payload),
    remove: (id) => post('/shell/drawing/delete', { id }),
    compile: (payload) => post<ShellCompileResponse>('/shell/drawing/compile', payload),
    publish: (id) => post<ShellPublishResponse>('/shell/drawing/publish', { id }),
    unpublish: (id) => post('/shell/drawing/unpublish', { id }),
    runtime: () => http.request<ShellRuntimeConfig>('/shell/config'),
    wireframes: (ids) => post<ShellWireframeItem[]>('/shell/drawings/wireframe', ids ? { ids } : {}),
    wireframeUrl: (id, width, height) => `/shell/drawing/wireframe?id=${id}&width=${width}&height=${height}`,
  }
}
