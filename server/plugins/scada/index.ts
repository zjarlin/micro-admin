// 组态插件（服务端）：把图元库与点位目录装配成 `ScadaService`。
//
// 读 JSON 在这里完成（Node 侧用 `readFile`），服务层只接收已解析的数据，
// 因此同一份服务代码也能被别的项目直接复用。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { KeyValueStore } from '@zjarlin/ui-server'
import { symbolsOfFile, type SymbolLibraryFile } from '../../../src/shared/scada/symbols.ts'
import { createScadaService, type ScadaService } from './service.ts'
import { scadaTags } from './tags.ts'
import { extrusionAiFromEnv } from './ai.ts'

const LIBRARY_PATH = fileURLToPath(new URL('../../../src/assets/scada/builtin-symbols.json', import.meta.url))

export interface ScadaPluginOptions {
  kv: KeyValueStore
  /** 覆盖图元库路径（换图元包时用）。 */
  libraryPath?: string
  namespace?: string
  /** 覆盖缺参追问的模型配置；缺省从环境变量读（无 key 时 AI 不启用）。 */
  ai?: ReturnType<typeof extrusionAiFromEnv>
}

export function createScadaPlugin(options: ScadaPluginOptions): ScadaService {
  const path = options.libraryPath ?? LIBRARY_PATH
  const file = JSON.parse(readFileSync(path, 'utf8')) as SymbolLibraryFile
  return createScadaService({
    kv: options.kv,
    symbols: symbolsOfFile(file),
    symbolVersion: file.version,
    tags: scadaTags(),
    ai: options.ai ?? extrusionAiFromEnv(),
    ...(options.namespace ? { namespace: options.namespace } : {}),
  })
}
