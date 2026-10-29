// SQLite 存储：Node 22 内置 `node:sqlite`，零外部依赖、零容器。
//
// 为什么不是 JSON 文件：多实例部署时文件锁不可靠；为什么不是外部数据库：
// 这个包的目标是「整体搬得走」，引入 Postgres 就必然带来一套运维。
// 真要换库时，只需实现同样的 `PageStore` / `SchemaStateStore` / `KeyValueStore` 三个接口。
//
// 表结构：
// - `ui_endpoint`  一份资源（端点）的全部行，JSON 数组整体存 —— 与引擎的快照语义一致；
// - `ui_schema`    页面配置覆盖层，按 key 存；
// - `ui_meta`      覆盖层的版本号与已删除 key；
// - `ui_kv`        其余单例数据（运行期日志/会话等由宿主决定存什么）。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  PageData,
  PageStore,
  SchemaStateStore,
  StoredSchemaState,
} from '@addzero/data-page'

/** 通用键值端口：宿主往 SQLite 里放任意单例数据。 */
export interface KeyValueStore {
  get<T>(key: string): T | null
  set(key: string, value: unknown): void
}

export interface SqliteStores {
  pages: PageStore
  schemas: SchemaStateStore
  kv: KeyValueStore
  /** 底层连接：宿主需要额外表时复用，不必再开一个数据库。 */
  db: DatabaseSync
  /** 实际落盘路径；`:memory:` 表示内存库。 */
  file: string
}

function parse<T>(payload: string | null | undefined): T | null {
  if (!payload) return null
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}

/**
 * 打开（并初始化）数据库。
 *
 * `file` 传 `:memory:` 用于测试与预览；传路径时自动建目录。
 * 开启 WAL：读写并发下不会互相阻塞，且进程被杀后不会留下半截事务。
 */
export function createSqliteStores(file: string): SqliteStores {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_endpoint (
      endpoint   TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ui_schema (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      version    INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ui_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ui_kv (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const now = (): string => new Date().toISOString()

  const pages: PageStore = {
    read(): PageData {
      const rows = db.prepare('SELECT endpoint, payload FROM ui_endpoint').all() as Array<{ endpoint: string; payload: string }>
      const data: PageData = {}
      for (const row of rows) {
        const value = parse<unknown>(row.payload)
        if (Array.isArray(value)) data[row.endpoint] = value as PageData[string]
      }
      return data
    },
    write(data: PageData): void {
      // 整表替换：引擎给的是全量快照，逐端点写回保证「删掉的行也真的消失」。
      const statement = db.prepare(
        'INSERT INTO ui_endpoint (endpoint, payload, updated_at) VALUES (?, ?, ?) '
        + 'ON CONFLICT(endpoint) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      )
      db.exec('BEGIN')
      try {
        const keep = Object.keys(data)
        const existing = db.prepare('SELECT endpoint FROM ui_endpoint').all() as Array<{ endpoint: string }>
        const drop = db.prepare('DELETE FROM ui_endpoint WHERE endpoint = ?')
        for (const row of existing) if (!keep.includes(row.endpoint)) drop.run(row.endpoint)
        for (const [endpoint, rows] of Object.entries(data)) statement.run(endpoint, JSON.stringify(rows), now())
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }

  const schemas: SchemaStateStore = {
    read(): StoredSchemaState | null {
      const rows = db.prepare('SELECT key, payload, version FROM ui_schema').all() as Array<{
        key: string
        payload: string
        version: number
      }>
      const meta = db.prepare('SELECT key, value FROM ui_meta').all() as Array<{ key: string; value: string }>
      const version = Number(meta.find((item) => item.key === 'version')?.value ?? Number.NaN)
      // 一行都没有且没有版本号：视为「从未写过」，让上层写入初始状态。
      if (!Number.isFinite(version)) return null
      const removed = parse<string[]>(meta.find((item) => item.key === 'removed')?.value) ?? []
      const out: StoredSchemaState = { version, pages: {}, removed }
      for (const row of rows) {
        const schema = parse<StoredSchemaState['pages'][string]['schema']>(row.payload)
        if (schema) out.pages[row.key] = { schema, version: row.version }
      }
      return out
    },
    write(state: StoredSchemaState): void {
      const upsert = db.prepare(
        'INSERT INTO ui_schema (key, payload, version, updated_at) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at',
      )
      const meta = db.prepare(
        'INSERT INTO ui_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      db.exec('BEGIN')
      try {
        const keep = Object.keys(state.pages)
        const existing = db.prepare('SELECT key FROM ui_schema').all() as Array<{ key: string }>
        const drop = db.prepare('DELETE FROM ui_schema WHERE key = ?')
        for (const row of existing) if (!keep.includes(row.key)) drop.run(row.key)
        for (const [key, entry] of Object.entries(state.pages)) {
          upsert.run(key, JSON.stringify(entry.schema), entry.version, now())
        }
        meta.run('version', String(state.version))
        meta.run('removed', JSON.stringify(state.removed ?? []))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }

  const kv: KeyValueStore = {
    get<T>(key: string): T | null {
      const row = db.prepare('SELECT payload FROM ui_kv WHERE key = ?').get(key) as { payload?: string } | undefined
      return parse<T>(row?.payload ?? null)
    },
    set(key: string, value: unknown): void {
      db.prepare(
        'INSERT INTO ui_kv (key, payload, updated_at) VALUES (?, ?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      ).run(key, JSON.stringify(value), now())
    },
  }

  return { pages, schemas, kv, db, file }
}
