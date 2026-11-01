// CAD 图纸（DXF）导入：图纸文本 → 组态绘图指令集 + 摘要。
//
// 三层分工（对应 `packages/cad-import`）：
// 1. 本地解析 DXF（不花一个 token）；
// 2. 归类成组态图元、生成指令集（也是本地）；
// 3. 只有「这堆框里哪个是泵」这种语义判断才交给模型，模型读的是摘要（几十行）。
//
// 因此这个接口**不落库**：前端先看到预览与体积对比，确认后才写画面。
// 这样「一次导入」不会悄悄改掉用户的画面，也让 AI 补语义可以反复试。
import { applyCommands, parseCommands, type DslDocument, type DslSymbol, type DslTag } from '@addzero/scada-dsl'
import { importCadFile } from '../../../src/shared/scada/cad.ts'
import type { ScadaSymbolDefinition, ScadaTagOption } from '../../../src/shared/scada/types.ts'

/** 图纸体积上限：DXF 是文本，5MB 已经是一张很密的图；再大就是误传了文件。 */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export interface CadImportPayload {
  fileName?: unknown
  /** 文本内容，或 base64（`base64: true` 时按 GBK/UTF-8 自动判定）。 */
  content?: unknown
  base64?: unknown
  options?: unknown
}

/**
 * `POST /scada/cad/import` 的实现：解析 + 归类 + 出指令，不落库。
 *
 * 返回体刻意带上 `bytes`（源文件 / 指令 / 摘要 三者字节数），
 * 界面直接用这组数字解释「为什么这套导入省 token」。
 */
export function importCad(payload: CadImportPayload): Record<string, unknown> {
  const raw = typeof payload.content === 'string' ? payload.content : ''
  if (!raw.trim()) throw badRequest('缺少 content：请把 DXF 文本（或 base64）传进来')
  const isBase64 = payload.base64 === true

  let source: string
  if (isBase64) {
    const bytes = Buffer.from(raw.replace(/^data:[^,]*,/, ''), 'base64')
    if (bytes.length > MAX_SOURCE_BYTES) throw badRequest(`图纸太大（${(bytes.length / 1048576).toFixed(1)}MB），上限 5MB`)
    source = decodeBytes(bytes)
  } else {
    if (raw.length > MAX_SOURCE_BYTES) throw badRequest(`图纸太大（${(raw.length / 1048576).toFixed(1)}MB），上限 5MB`)
    // 纯文本按 UTF-8 直读；国内 CAD 导出的 GBK 图纸要按 base64 传，由服务端重解。
    source = raw
  }

  const options = (typeof payload.options === 'object' && payload.options !== null ? payload.options : {}) as Record<string, unknown>
  const canvas = (typeof options.canvas === 'object' && options.canvas !== null ? options.canvas : null) as Record<string, unknown> | null
  const layers = Array.isArray(options.layers) ? options.layers.filter((item): item is string => typeof item === 'string') : undefined

  let result
  try {
    result = importCadFile(source, {
      ...(canvas
        ? {
            canvas: {
              width: Math.min(Math.max(numberOr(canvas.width, 1920), 320), 7680),
              height: Math.min(Math.max(numberOr(canvas.height, 1080), 240), 4320),
            },
          }
        : {}),
      ...(layers && layers.length > 0 ? { layers } : {}),
      ...(Number.isFinite(Number(options.minSize)) ? { minSize: Math.min(Math.max(Number(options.minSize), 1), 64) } : {}),
      ...(Number.isFinite(Number(options.maxShapes)) ? { maxShapes: Math.min(Math.max(Number(options.maxShapes), 8), 600) } : {}),
      ...(Number.isFinite(Number(options.snapAngle)) ? { snapAngle: Math.min(Math.max(Number(options.snapAngle), 0), 45) } : {}),
    })
  } catch (error) {
    // 解析器的报错本来就是写给人看的（「这是二进制 DWG，请另存为 DXF」），原样转 400。
    throw badRequest(error instanceof Error ? error.message : 'DXF 解析失败')
  }

  return {
    fileName: typeof payload.fileName === 'string' ? payload.fileName : '',
    drawing: {
      version: result.drawing.version,
      units: result.drawing.units,
      layers: result.drawing.layers,
      extents: result.drawing.extents,
      stats: result.drawing.stats,
    },
    stats: result.symbolized.stats,
    canvas: result.symbolized.canvas,
    scale: result.symbolized.scale,
    shapes: result.symbolized.shapes,
    commands: result.commands,
    digest: result.digest,
    warnings: result.warnings,
    bytes: result.bytes,
  }
}

/** 字节 → 文本：先按 UTF-8 解，出现替换字符再按 GBK 解。 */
function decodeBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return utf8
  }
}

/**
 * `POST /scada/cad/apply`：把指令集落到一份文档上（不落库，返回新文档 + 逐行问题）。
 *
 * 为什么走服务端而不是前端自己执行：`applyCommands` 是 `@addzero/scada-dsl` 的唯一实现，
 * 前端再抄一份就等于两套几何语义。这里与 `/ai/draw` 用的是同一个函数，
 * 所以「CAD 导入的画面」与「AI 画的画面」行为完全一致。
 */
export function applyCadCommands(
  payload: { document?: unknown; commands?: unknown },
  symbols: ScadaSymbolDefinition[],
  tags: ScadaTagOption[],
): Record<string, unknown> {
  const document = payload.document as DslDocument | undefined
  if (!document || !Array.isArray(document.widgets) || !document.canvas) {
    throw badRequest('缺少 document：需要传入当前画布文档')
  }
  const source = typeof payload.commands === 'string' ? payload.commands : ''
  if (!source.trim()) throw badRequest('缺少 commands：没有可执行的指令')

  const dslSymbols: DslSymbol[] = symbols.map((symbol) => ({
    key: symbol.key,
    name: symbol.name,
    defaultWidth: symbol.defaultWidth,
    defaultHeight: symbol.defaultHeight,
    keepAspect: symbol.keepAspect,
    props: symbol.props.map((prop) => ({ key: prop.key, default: prop.default })),
    bindingSlots: symbol.bindingSlots.map((slot) => ({ key: slot.key, label: slot.label })),
  }))
  const dslTags: DslTag[] = tags.map((tag) => ({ tagId: tag.tagId, name: tag.name, unit: null }))

  const parsed = parseCommands(source)
  const applied = applyCommands(parsed.commands, { document, symbols: dslSymbols, tags: dslTags })
  return {
    document: applied.document,
    applied: applied.applied,
    issues: [...parsed.issues, ...applied.issues],
  }
}
