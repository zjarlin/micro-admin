// 外壳服务：外壳图纸 CRUD、编译、发布，以及「运行期读什么外壳」的公开接口。
//
// 与 UI 无关，只依赖 SQLite（kv）与共享的外壳编译器，因此可以整体搬走。
//
// 「画完即上线」在这里闭环：发布 = 编译外壳图纸 → 存进 kv → 前端拉 `/shell/config`
// 即按新外壳渲染，不需要发版、不需要 Vite。外壳本就是个纯 JSON schema，能下发、能回滚。

import { RawResponse, type ExtensionRequest, type ExtensionUser, type KeyValueStore } from '@zjarlin/ui-server'
import {
  compileShellDrawing,
  createEmptyShellDrawing,
  inspectCode,
  parseShellDrawing,
  renderShellWireframe,
  type ShellCompiled,
  type UiDiagnostic,
  type ShellDrawing,
} from '../../../packages/ui-canvas/src/index.ts'

/** 写外壳所需权限码（与页面配置同一命名空间风格）。 */
export const SHELL_WRITE_PERMISSION = 'system:shell:config'

export const UNHANDLED = Symbol('shell-unhandled')

interface StoredShellDrawing {
  id: number
  name: string
  description: string | null
  drawingJson: string
  version: number
  /** 最近一次发布的 key（null 表示只存了图纸）。 */
  publishedKey: string | null
  /** 最近一次发布的 schema 版本。 */
  publishedVersion: number | null
  sortIndex: number
  createdAt: number
  updatedAt: number
}

interface ShellState {
  drawings: StoredShellDrawing[]
  nextId: number
}

/** 已发布外壳：运行期唯一读到的就是它。 */
interface PublishedShell {
  key: string
  version: number
  schema: Record<string, unknown>
  publishedAt: number
}

export interface ShellServiceOptions {
  kv: KeyValueStore
  namespace?: string
}

export interface ShellService {
  handle(request: ExtensionRequest): Promise<unknown | typeof UNHANDLED>
}

function errorOf(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function allowed(user: ExtensionUser | null, permission: string): boolean {
  if (!user) return false
  return user.permissions.includes('*:*:*') || user.permissions.includes('*') || user.permissions.includes(permission)
}

/** 编译 + 模板安全检查：诊断合并成一份，前端只需渲染一套。 */
export function diagnoseShell(drawing: ShellDrawing): { compiled: ShellCompiled; diagnostics: UiDiagnostic[] } {
  const compiled = compileShellDrawing(drawing)
  const diagnostics = [...compiled.diagnostics]
  for (const element of drawing.elements) {
    const code = String((element.props as { code?: string }).code ?? '')
    for (const issue of inspectCode(code)) {
      diagnostics.push({ level: issue.level, code: 'shell-code', elementId: element.id, message: issue.message })
    }
  }
  return { compiled, diagnostics }
}

/** 种子：一份与内置外壳等价的图纸，可删（内置外壳仍是兜底）。 */
export function seedShellDrawings(): StoredShellDrawing[] {
  const now = Date.now()
  const drawing = createEmptyShellDrawing('shell.default', '默认外壳')
  return [{
    id: 1,
    name: '默认外壳',
    description: '内置外壳的图纸版：侧栏品牌/菜单/搜索/收起、顶栏面包屑/图标行/用户区。',
    drawingJson: JSON.stringify(drawing),
    version: 1,
    publishedKey: null,
    publishedVersion: null,
    sortIndex: 0,
    createdAt: now,
    updatedAt: now,
  }]
}

function summaryOf(record: StoredShellDrawing): Record<string, unknown> {
  const drawing = parseShellDrawing(record.drawingJson)
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    publishedKey: record.publishedKey,
    publishedVersion: record.publishedVersion,
    elementCount: drawing.elements.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sortIndex: record.sortIndex,
    title: drawing.meta.title,
    roleCounts: drawing.elements.reduce<Record<string, number>>((acc, element) => {
      acc[element.role] = (acc[element.role] ?? 0) + 1
      return acc
    }, {}),
  }
}

function detailOf(record: StoredShellDrawing): Record<string, unknown> {
  return { ...summaryOf(record), drawingJson: record.drawingJson }
}

export function createShellService(options: ShellServiceOptions): ShellService {
  const stateKey = `${options.namespace ?? 'shell'}:state`
  const publishedKey = `${options.namespace ?? 'shell'}:published`

  function load(): ShellState {
    const existing = options.kv.get<ShellState>(stateKey)
    if (existing?.drawings) return existing
    const seeded: ShellState = { drawings: seedShellDrawings(), nextId: 2 }
    options.kv.set(stateKey, seeded)
    return seeded
  }

  function save(state: ShellState): void {
    options.kv.set(stateKey, state)
  }

  function requireDrawing(state: ShellState, id: number): StoredShellDrawing {
    const record = state.drawings.find((item) => item.id === id)
    if (!record) throw errorOf('外壳图纸不存在', 404)
    return record
  }

  return {
    async handle(request): Promise<unknown | typeof UNHANDLED> {
      const { method, path, query, user } = request
      const body = (typeof request.body === 'object' && request.body !== null
        ? request.body
        : {}) as Record<string, unknown>
      const state = load()

      // ---------------- 运行期外壳（公开读，不含业务数据） ----------------

      if (path === '/shell/config' && method === 'GET') {
        const published = options.kv.get<PublishedShell>(publishedKey)
        return { shell: published?.schema ?? null, version: published?.version ?? 0, key: published?.key ?? null }
      }

      // ---------------- 图纸 CRUD ----------------

      if (path === '/shell/drawings' && method === 'GET') {
        return state.drawings
          .slice()
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map(summaryOf)
      }

      if (path === '/shell/drawing' && method === 'GET') {
        return detailOf(requireDrawing(state, Number(query.get('id') ?? 0)))
      }

      if (path === '/shell/drawing/create' && method === 'POST') {
        if (!allowed(user, SHELL_WRITE_PERMISSION)) throw errorOf(`缺少外壳配置权限：${SHELL_WRITE_PERMISSION}`, 403)
        const name = String(body.name ?? '').trim()
        if (!name) throw errorOf('外壳图纸名称不能为空', 400)
        const drawing = typeof body.drawingJson === 'string' && body.drawingJson.trim()
          ? parseShellDrawing(body.drawingJson, `shell.draft-${state.nextId}`)
          : createEmptyShellDrawing(`shell.draft-${state.nextId}`, name)
        const now = Date.now()
        const record: StoredShellDrawing = {
          id: state.nextId,
          name,
          description: typeof body.description === 'string' ? body.description : null,
          drawingJson: JSON.stringify(drawing),
          version: 1,
          publishedKey: null,
          publishedVersion: null,
          sortIndex: state.drawings.length,
          createdAt: now,
          updatedAt: now,
        }
        state.nextId += 1
        state.drawings.push(record)
        save(state)
        return detailOf(record)
      }

      if (path === '/shell/drawing/update' && method === 'POST') {
        if (!allowed(user, SHELL_WRITE_PERMISSION)) throw errorOf(`缺少外壳配置权限：${SHELL_WRITE_PERMISSION}`, 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
        if (typeof body.description === 'string') record.description = body.description
        if (typeof body.drawingJson === 'string' && body.drawingJson.trim()) {
          record.drawingJson = JSON.stringify(parseShellDrawing(body.drawingJson))
        }
        record.version += 1
        record.updatedAt = Date.now()
        save(state)
        return detailOf(record)
      }

      if (path === '/shell/drawing/delete' && method === 'POST') {
        if (!allowed(user, SHELL_WRITE_PERMISSION)) throw errorOf(`缺少外壳配置权限：${SHELL_WRITE_PERMISSION}`, 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        state.drawings = state.drawings.filter((item) => item.id !== record.id)
        save(state)
        return { deleted: record.id, publishedKey: record.publishedKey }
      }

      // ---------------- 编译 ----------------

      if (path === '/shell/drawing/compile' && method === 'POST') {
        const raw = typeof body.drawingJson === 'string' ? body.drawingJson : ''
        const drawing = raw.trim()
          ? parseShellDrawing(raw)
          : parseShellDrawing(requireDrawing(state, Number(body.id ?? 0)).drawingJson)
        const { compiled, diagnostics } = diagnoseShell(drawing)
        return {
          key: compiled.key,
          schema: compiled.schema,
          diagnostics,
          analysis: compiled.analysis,
          blocked: diagnostics.some((item) => item.level === 'error'),
        }
      }

      // ---------------- 发布 / 下线 ----------------

      if (path === '/shell/drawing/publish' && method === 'POST') {
        if (!allowed(user, SHELL_WRITE_PERMISSION)) throw errorOf(`缺少外壳配置权限：${SHELL_WRITE_PERMISSION}`, 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        const drawing = parseShellDrawing(record.drawingJson, record.name)
        const { compiled, diagnostics } = diagnoseShell(drawing)
        const errors = diagnostics.filter((item) => item.level === 'error')
        if (errors.length) {
          throw errorOf(`外壳图纸还有 ${errors.length} 处错误，先修好再发布：${errors.map((item) => item.message).join('；')}`, 400)
        }
        if (!compiled.key?.trim()) throw errorOf('外壳图纸缺少 key，无法发布', 400)
        const published: PublishedShell = {
          key: compiled.key,
          version: record.version,
          schema: compiled.schema as unknown as Record<string, unknown>,
          publishedAt: Date.now(),
        }
        options.kv.set(publishedKey, published)
        record.publishedKey = compiled.key
        record.publishedVersion = record.version
        record.updatedAt = Date.now()
        save(state)
        return {
          key: compiled.key,
          version: record.version,
          warnings: diagnostics.filter((item) => item.level !== 'error').map((item) => item.message),
          analysis: compiled.analysis,
        }
      }

      if (path === '/shell/drawing/unpublish' && method === 'POST') {
        if (!allowed(user, SHELL_WRITE_PERMISSION)) throw errorOf(`缺少外壳配置权限：${SHELL_WRITE_PERMISSION}`, 403)
        const record = requireDrawing(state, Number(body.id ?? 0))
        if (!record.publishedKey) return { key: null, removed: false }
        const key = record.publishedKey
        options.kv.set(publishedKey, null)
        record.publishedKey = null
        record.publishedVersion = null
        record.updatedAt = Date.now()
        save(state)
        return { key, removed: true }
      }

      // ---------------- 缩略图（线框图，服务端出图） ----------------

      if (path === '/shell/drawings/wireframe' && method === 'POST') {
        // 九宫格一次拿整页：浏览器 <img> 带不了 Bearer，所以由后端批量出 SVG。
        const ids = Array.isArray(body.ids) ? body.ids.map(Number) : null
        return state.drawings
          .filter((record) => !ids || ids.includes(record.id))
          .sort((left, right) => left.sortIndex - right.sortIndex || left.id - right.id)
          .map((record) => {
            const drawing = parseShellDrawing(record.drawingJson)
            const { diagnostics } = diagnoseShell(drawing)
            return {
              id: record.id,
              svg: renderShellWireframe(drawing, { maxWidth: 480, maxHeight: 300 }),
              errorCount: diagnostics.filter((item) => item.level === 'error').length,
              warnCount: diagnostics.filter((item) => item.level === 'warn').length,
              published: Boolean(record.publishedKey),
            }
          })
      }

      if (path === '/shell/drawing/wireframe' && method === 'GET') {
        const record = requireDrawing(state, Number(query.get('id') ?? 0))
        const drawing = parseShellDrawing(record.drawingJson)
        const svg = renderShellWireframe(drawing, {
          maxWidth: Number(query.get('width') ?? 1280) || 1280,
          maxHeight: Number(query.get('height') ?? 0) || 0,
        })
        return new RawResponse(svg, 'image/svg+xml; charset=utf-8', { inline: true })
      }

      return UNHANDLED
    },
  }
}
