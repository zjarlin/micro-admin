// 浏览器侧的图元库入口：把 JSON 交给共享的解析函数。
//
// 拆成单独文件的原因：`symbols.ts` 要能被 Node 直接 import（那里没有 Vite 的 JSON 解析），
// 而 Vite 的 `import ... from '*.json'` 只有浏览器构建链认识。
import library from '@/assets/scada/builtin-symbols.json'
import { indexSymbols, symbolsOfFile, type SymbolLibraryFile } from './symbols'
import type { ScadaSymbolDefinition } from './types'

const file = library as unknown as SymbolLibraryFile

/** 图元库版本，与 `symbols.json` 的 `version` 一致。 */
export const SCADA_SYMBOL_VERSION = file.version

/** 全部内置图元；每次返回独立副本，避免编辑期改动污染全局定义。 */
export function builtinSymbols(): ScadaSymbolDefinition[] {
  return symbolsOfFile(file)
}

export { indexSymbols }
