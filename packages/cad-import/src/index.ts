// CAD → 组态画布的门面。
//
// 三层可单独用：
// - `parseDxf`：DXF 文本 → 实体（不依赖任何图形库）；
// - `symbolize`：实体 → 组态图元（归类、合并、缩放）；
// - `shapesToCommands` / `shapesDigest`：图元 → 绘图指令集 / 给模型看的摘要。
//
// 一条完整链：`importCadFile(text)` → 指令 + 摘要 + 统计；指令交给 `applyCommands`
// 就是画布文档，摘要交给模型就够它做语义补全，两者都不需要读原始 DXF。
import { parseDxf } from './dxf.ts'
import { symbolize } from './symbolize.ts'
import { shapesDigest, shapesToCommands, type CadCommandOptions } from './commands.ts'
import type { CadDrawing, CadSymbolizeOptions, CadSymbolizeResult } from './types.ts'

export { detectCadFormat, parseDxf } from './dxf.ts'
export type { CadFileFormat } from './dxf.ts'
export { dwgToDrawing } from './dwg.ts'
export type { DwgDatabaseLike, DwgVersionLike } from './dwg.ts'
export { symbolize } from './symbolize.ts'
export { shapesToCommands, shapesDigest } from './commands.ts'
export type { CadCommandOptions } from './commands.ts'
export type {
  CadDrawing,
  CadEntity,
  CadLayer,
  CadPoint,
  CadShape,
  CadSymbolizeOptions,
  CadSymbolizeResult,
  CadUnit,
} from './types.ts'

export interface CadImportOptions extends CadSymbolizeOptions, CadCommandOptions {}

export interface CadImportResult {
  drawing: CadDrawing
  symbolized: CadSymbolizeResult
  /** 可直接执行的绘图指令（`applyCommands` 吃它）。 */
  commands: string
  /** 给模型看的摘要（固定几十行，与图纸大小无关）。 */
  digest: string
  warnings: string[]
  /** 体积对比：用来证明「省 token」这件事不是口号。 */
  bytes: { source: number; commands: number; digest: number }
}

/**
 * 一次完整导入：DXF 文本 → 指令 + 摘要。
 *
 * 不做 I/O（读文件、解码编码由调用方负责），因此浏览器与 Node 都能直接用。
 */
export function importCadFile(text: string, options: CadImportOptions = {}): CadImportResult {
  return symbolizeDrawing(parseDxf(text), text.length, options)
}

/**
 * 一次完整导入：**已解析好的图纸** → 指令 + 摘要。
 *
 * DXF 与 DWG 共用这一步：谁都不需要在下游再写一遍归类/缩放/指令生成，
 * 「CAD 导入的画面」在两种格式下是同一套规则。
 */
export function symbolizeDrawing(drawing: CadDrawing, sourceBytes: number, options: CadImportOptions = {}): CadImportResult {
  const layers = options.layers && options.layers.length > 0
    ? options.layers
    // 不指定图层时只保留可见图层：CAD 里被关掉的图层（尺寸标注、图框）不该进画面。
    : drawing.layers.filter((layer) => layer.visible).map((layer) => layer.name)
  const symbolized = symbolize(drawing.entities, { ...options, ...(layers.length ? { layers } : {}) })
  const commands = shapesToCommands(symbolized, options)
  const digest = shapesDigest(symbolized)
  return {
    drawing,
    symbolized,
    commands,
    digest,
    warnings: [...drawing.warnings, ...symbolized.warnings],
    bytes: {
      source: sourceBytes,
      commands: commands.length,
      digest: digest.length,
    },
  }
}
