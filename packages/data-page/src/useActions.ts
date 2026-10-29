// 行操作：把 schema 里的声明式 `ActionSchema` 执行成真实请求。
//
// 与 UI 库无关：确认框与提示通过注入的 `Notifier` 提供，
// Element Plus 适配层在 `src/components/data/notifier.ts` 里实现它。
import type { DataTransport } from './transport.ts'
import type { ActionSchema, Row } from './schema.ts'
import { interpolate, matchCondition } from './schema.ts'

/** 通知接口：共享层唯一的 UI 依赖注入点。 */
export interface Notifier {
  /** 二次确认；用户取消时 resolve `false`。 */
  confirm(message: string, title: string): Promise<boolean>
  success(message: string): void
  error(message: string): void
  info?(message: string): void
}

export interface ActionContext {
  /** `seed` 为触发该动作的行（如「新增下级」需要父级 id）；顶层新增时为空。 */
  openCreate(seed?: Row): void
  openEdit(row: Row): void
  openDetail?(row: Row): void
  reload(): void | Promise<void>
  can(permission?: string): boolean
  notifier: Notifier
  /** 行操作的请求前缀，通常是页面的 `endpoint`。 */
  endpoint: string
  rowKey: string
}

export interface ResolvedAction {
  schema: ActionSchema
  visible(row: Row): boolean
  disabled(row: Row): boolean
  run(row: Row): Promise<void>
}

/**
 * 默认行操作：schema 没写 `actions` 时派生「编辑 / 删除」。
 *
 * 与旧页面的手写行为一致：删除需二次确认，失败不静默。
 */
export function defaultActions(actions: ActionSchema[] | undefined): ActionSchema[] {
  if (actions?.length) return actions
  return [
    { key: 'edit', label: '编辑', variant: 'primary', kind: 'edit' },
    // 文案里的 `{name}` 由具体页面的行字段决定；没命中就退化成通用文案。
    { key: 'delete', label: '删除', variant: 'danger', kind: 'delete' },
  ]
}

/** 行操作的二次确认文案：`delete` 缺省给一句带主键的提示。 */
function confirmOf(action: ActionSchema, row: Row, rowKey: string): string | null {
  if (action.confirm) return interpolate(action.confirm, row)
  if (action.kind === 'delete') return `删除 ${String(row[rowKey] ?? '')} 后不可恢复，确定继续？`
  return null
}

export function resolveActions(
  http: DataTransport,
  actions: ActionSchema[],
  ctx: ActionContext,
): ResolvedAction[] {
  return actions.map((action) => {
    const disabled = (row: Row): boolean => {
      if (action.permission && !ctx.can(action.permission)) return true
      // `disabledWhen` 是「命中即禁用」；没有声明就是不禁用。
      // 之前写成取反，导致内置管理员可删、普通用户反而被禁用。
      if (!action.disabledWhen) return false
      return matchCondition(row, action.disabledWhen)
    }

    async function confirmIfNeeded(row: Row): Promise<boolean> {
      const message = confirmOf(action, row, ctx.rowKey)
      if (!message) return true
      return ctx.notifier.confirm(message, action.label)
    }

    async function requestOf(row: Row): Promise<void> {
      const request = action.request
      if (request) {
        const body = request.body
          ? (JSON.parse(interpolate(JSON.stringify(request.body), row)) as Record<string, unknown>)
          : undefined
        await http.request<unknown>(interpolate(request.path, row), {
          method: request.method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return
      }
      // 没写 `request` 的动作按 REST 约定落到 `endpoint/{rowKey}`。
      const path = `${ctx.endpoint}/${String(row[ctx.rowKey] ?? '')}`
      await http.request<void>(path, { method: action.kind === 'delete' ? 'DELETE' : 'PATCH' })
    }

    return {
      schema: action,
      visible: (row: Row) => matchCondition(row, action.visibleWhen),
      disabled,
      async run(row: Row): Promise<void> {
        if (disabled(row)) return
        switch (action.kind) {
          case 'create':
            // 行级「新增下级」把当前行交给页面，由页面按 `tree.parentProp` 预填父级。
            ctx.openCreate(row)
            return
          case 'edit':
            ctx.openEdit(row)
            return
          case 'detail':
            ctx.openDetail?.(row)
            return
          case 'delete': {
            if (!(await confirmIfNeeded(row))) return
            try {
              await http.request<void>(`${ctx.endpoint}/${String(row[ctx.rowKey] ?? '')}`, { method: 'DELETE' })
              ctx.notifier.success('已删除')
              await ctx.reload()
            } catch (cause) {
              ctx.notifier.error(cause instanceof Error ? cause.message : '删除失败')
            }
            return
          }
          case 'toggle':
          case 'request': {
            if (!(await confirmIfNeeded(row))) return
            try {
              await requestOf(row)
              ctx.notifier.success(`${action.label}成功`)
              await ctx.reload()
            } catch (cause) {
              ctx.notifier.error(cause instanceof Error ? cause.message : `${action.label}失败`)
            }
            return
          }
          default:
            return
        }
      },
    }
  })
}
