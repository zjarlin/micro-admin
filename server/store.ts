// 文件存储适配器：把通用引擎的 `PageStore` / 运行期的 `RuntimeStore` 落到 JSON 文件。
//
// 选择 JSON 而不是数据库，是为了让「万能页面」后端可以整体搬走：
// 换 Postgres 只需要再实现同一个接口，引擎与页面层一行不改。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PageData, PageStore } from '../src/shared/data/engine.ts'
import type { RuntimeData, RuntimeStore } from '../src/shared/runtime/api.ts'

/**
 * 原子写：先写临时文件再 rename，避免进程中断留下半截 JSON。
 *
 * 单进程部署足够；多进程时换成数据库或加文件锁。
 */
function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

export function createFileStores(dataDir: string): { pages: PageStore; runtime: RuntimeStore; files: { pages: string; runtime: string } } {
  const pagesFile = join(dataDir, 'pages.json')
  const runtimeFile = join(dataDir, 'runtime.json')

  return {
    files: { pages: pagesFile, runtime: runtimeFile },
    pages: {
      read(): PageData {
        return readJson<PageData>(pagesFile) ?? {}
      },
      write(data: PageData): void {
        writeJson(pagesFile, data)
      },
    },
    runtime: {
      read(): RuntimeData | null {
        return readJson<RuntimeData>(runtimeFile)
      },
      write(data: RuntimeData): void {
        writeJson(runtimeFile, data)
      },
    },
  }
}
