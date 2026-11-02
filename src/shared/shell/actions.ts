// 外壳动作执行：把图纸上配的「点击事件」在运行期真的做出来。
//
// 为什么单独一份：外壳条目与页面元素的动作集同构（跳转/请求/命令/派发/弹窗），
// 但外壳的执行上下文不同——它拿的是内核命令、事件总线与路由器，而不是页面壳内部状态。
// 因此这里只做「声明式动作 → 一步真实副作用」的翻译，不掺任何外壳几何/渲染。
//
// 安全性：动作参数全部来自后端下发的 JSON，运行期只按白名单动作分派；
// 不 eval、不拼接代码，未知动作只提示不执行。
import type { Router } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { HttpClient } from '@/shared/http'
import type { ShellAction } from './index.ts'

/** 动作执行上下文：由外壳在挂载时注入，动作本身不认识 Vue / store。 */
export interface ShellActionContext {
  router: Pick<Router, 'push'>
  http: HttpClient
  /** 派发内核事件（`emit` 动作）。 */
  emit: (event: string, payload?: unknown) => void
  /** 执行内核命令（`command` 动作）。 */
  command: (name: string, ...args: unknown[]) => Promise<unknown>
}

/** 动作执行结果：给调用方一个可反馈的信号（弹过确认 / 发过请求 / 什么都没做）。 */
export interface ShellActionOutcome {
  kind: ShellAction['kind']
  ok: boolean
  detail?: string
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key]
  return typeof value === 'string' ? value : ''
}

/** 二次确认：给了 `confirm` 就先弹，用户取消则整体不执行。 */
async function confirmIfNeeded(action: ShellAction): Promise<boolean> {
  if (!action.confirm) return true
  try {
    await ElMessageBox.confirm(action.confirm, '确认操作', {
      type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}

/**
 * 执行一个外壳动作。
 *
 * 每个分支只做一件事，且失败都转成可读提示：外壳条目是入口，静默失败最伤人，
 * 所以「缺参数」「请求失败」「命令不存在」都必须说话。
 */
export async function dispatchShellAction(
  action: ShellAction | undefined,
  ctx: ShellActionContext,
): Promise<ShellActionOutcome> {
  if (!action || action.kind === 'none') return { kind: 'none', ok: true }
  if (!(await confirmIfNeeded(action))) return { kind: action.kind, ok: false, detail: '已取消' }

  const params = action.params ?? {}
  try {
    switch (action.kind) {
      case 'navigate': {
        const path = stringParam(params, 'path')
        if (!path) { ElMessage.warning('该入口没有配置目标路径'); return { kind: 'navigate', ok: false } }
        const query = params.query && typeof params.query === 'object'
          ? (params.query as Record<string, string>)
          : undefined
        await ctx.router.push(query ? { path, query } : path)
        return { kind: 'navigate', ok: true, detail: path }
      }
      case 'request': {
        const path = stringParam(params, 'path')
        if (!path) { ElMessage.warning('该入口没有配置接口路径'); return { kind: 'request', ok: false } }
        const method = (stringParam(params, 'method') || 'POST').toUpperCase()
        const body = params.body === undefined ? undefined : JSON.stringify(params.body)
        const result = await ctx.http.request<unknown>(path, {
          method,
          ...(body === undefined ? {} : { body }),
        })
        void result
        ElMessage.success(params.success ? String(params.success) : '操作已完成')
        return { kind: 'request', ok: true, detail: `${method} ${path}` }
      }
      case 'command': {
        const name = stringParam(params, 'name')
        if (!name) { ElMessage.warning('该入口没有配置命令名'); return { kind: 'command', ok: false } }
        const args = Array.isArray(params.args) ? params.args : []
        await ctx.command(name, ...args)
        return { kind: 'command', ok: true, detail: name }
      }
      case 'emit': {
        const event = stringParam(params, 'event')
        if (!event) { ElMessage.warning('该入口没有配置事件名'); return { kind: 'emit', ok: false } }
        ctx.emit(event, params.payload)
        return { kind: 'emit', ok: true, detail: event }
      }
      case 'dialog': {
        const title = stringParam(params, 'title') || stringParam(params, 'label') || '提示'
        const message = stringParam(params, 'message') || stringParam(params, 'content') || '这是一个可配置的弹窗入口'
        await ElMessageBox.alert(message, title, { confirmButtonText: '知道了' })
        return { kind: 'dialog', ok: true, detail: title }
      }
      default:
        ElMessage.warning(`未知动作：${String((action as { kind?: unknown }).kind)}`)
        return { kind: action.kind, ok: false, detail: '未知动作' }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    ElMessage.error(`动作执行失败：${detail}`)
    return { kind: action.kind, ok: false, detail }
  }
}
