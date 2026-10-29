// 内置图元库：与 Rust crate `az-scada-canvas` 的 `builtin-symbols.json` 同一份数据。
//
// 这份 JSON 是图元的唯一权威来源：前端只做索引与校验，不在这里新增图元；
// 换图元包时替换 `src/assets/scada/builtin-symbols.json` 并重跑校验即可。
//
// 注意：该 JSON 是 serde 的稀疏输出——`bindingSlots` / `props` / `parts` / `ports`
// 为空时会被 `skip_serializing_if` 省略，`keepAspect` / `version` 缺省不写。
// 后端反序列化靠 `serde(default)` 补齐，前端没有这层，必须在加载处补同样的默认值，
// 否则 `symbol.bindingSlots.find(...)` 会抛错并让整块画布渲染不出来。
import library from '@/assets/scada/builtin-symbols.json'
import type {
  ScadaBindingSlotSpec,
  ScadaPropSpec,
  ScadaSymbolDefinition,
  ScadaSymbolPart,
  ScadaSymbolPort,
} from './types'

interface SymbolLibraryFile {
  version: number
  symbols: Partial<ScadaSymbolDefinition>[]
}

const file = library as unknown as SymbolLibraryFile

/** 图元库版本，与 `symbols.json` 的 `version` 一致。 */
export const SCADA_SYMBOL_VERSION = file.version

/** 按 crate `SymbolDefinition` 的 serde 默认值把稀疏字段补齐。 */
function normalize(raw: Partial<ScadaSymbolDefinition>): ScadaSymbolDefinition {
  return {
    key: String(raw.key ?? ''),
    name: String(raw.name ?? ''),
    category: raw.category ?? 'custom',
    defaultWidth: Number(raw.defaultWidth ?? 100),
    defaultHeight: Number(raw.defaultHeight ?? 100),
    keepAspect: Boolean(raw.keepAspect),
    description: raw.description ?? null,
    palette: { ...(raw.palette ?? {}) },
    props: (raw.props ?? []) as ScadaPropSpec[],
    bindingSlots: (raw.bindingSlots ?? []) as ScadaBindingSlotSpec[],
    parts: (raw.parts ?? []) as ScadaSymbolPart[],
    ports: (raw.ports ?? []) as ScadaSymbolPort[],
    version: Number(raw.version ?? 1),
  }
}

/** 全部内置图元；每次返回独立副本，避免编辑期改动污染全局定义。 */
export function builtinSymbols(): ScadaSymbolDefinition[] {
  return file.symbols.map((symbol) => structuredClone(normalize(symbol)))
}

/** 按 `key` 建索引，供画布求值按 `widget.symbolKey` 查定义。 */
export function indexSymbols(symbols: ScadaSymbolDefinition[]): Record<string, ScadaSymbolDefinition> {
  const map: Record<string, ScadaSymbolDefinition> = {}
  for (const symbol of symbols) map[symbol.key] = symbol
  return map
}
