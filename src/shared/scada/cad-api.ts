// CAD 导入的前端契约：只描述 HTTP 形状，不掺 UI。
//
// 三段对应服务端三个接口：解析（`/scada/cad/import`）、应用指令（`/scada/cad/apply`）、
// AI 补语义（复用 `/ai/draw` + `scada.cad` 提示词）。前端不解析 DXF、不算几何。
import type { HttpClient } from '../http.ts'
import type { ScadaDocument, ScadaSymbolDefinition, ScadaTagOption } from './types.ts'
import type { CadLayer, CadSymbolizeResult } from './cad.ts'

export interface CadImportOptions {
  canvas?: { width: number; height: number }
  layers?: string[]
  minSize?: number
  maxShapes?: number
  snapAngle?: number
}

export interface CadImportView {
  fileName: string
  drawing: {
    version: string
    units: string
    layers: CadLayer[]
    extents: { min: { x: number; y: number }; max: { x: number; y: number } } | null
    stats: { raw: number; expanded: number; blocks: number }
  }
  stats: CadSymbolizeResult['stats']
  canvas: { width: number; height: number }
  scale: number
  commands: string
  digest: string
  warnings: string[]
  bytes: { source: number; commands: number; digest: number }
}

export interface CadApplyResult {
  document: ScadaDocument
  applied: string[]
  issues: Array<{ line: number; severity: 'error' | 'warn'; message: string; source: string }>
}

/** 图纸 → 指令集。`base64` 时按字节传（GBK 图纸走这条），服务端自己判编码。 */
export async function importCad(
  http: HttpClient,
  input: { fileName: string; content: string; base64?: boolean; options?: CadImportOptions },
): Promise<CadImportView> {
  return http.request<CadImportView>('/scada/cad/import', { method: 'POST', body: JSON.stringify(input) })
}

/** 指令集 → 文档。与 `/ai/draw` 同一个执行器，前端不做第二次几何实现。 */
export async function applyCad(
  http: HttpClient,
  input: { document: ScadaDocument; commands: string },
): Promise<CadApplyResult> {
  return http.request<CadApplyResult>('/scada/cad/apply', { method: 'POST', body: JSON.stringify(input) })
}

/** 语义补全：把摘要 + 当前画面交给模型，只要求它换设备类型、接变量、改名。 */
export async function refineCad(
  http: HttpClient,
  input: {
    prompt: string
    digest: string
    document: ScadaDocument
    symbols: ScadaSymbolDefinition[]
    tags: ScadaTagOption[]
  },
): Promise<{ document: ScadaDocument; applied: string[]; issues: CadApplyResult['issues']; commands: string; model: string }> {
  return http.request('/ai/draw', {
    method: 'POST',
    body: JSON.stringify({ ...input, promptId: 'scada.cad' }),
  })
}
