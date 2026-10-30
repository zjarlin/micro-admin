// 活元素的宿主装配：把声明式动作接到页面能力上（请求、重载、弹窗、跳转、派发）。
//
// 模板只拿到 `onClick` / `onChange` 这些方法名，永远拿不到 http / router / store；
// 动作到底做什么，由这里的 `VibeBindingSchema.action` 决定。因此同一段模板
// 在列表、树表、弹窗里都能跑，而权限与副作用仍由宿主掌握。

import type { DataTransport, Row, VibeBindingSchema, VibeSchema } from '@zjarlin/data-page'
import { interpolate, matchCondition } from '@zjarlin/data-page'
import type { InjectionKey } from 'vue'
import { inject, provide } from 'vue'

/** 模板可用的宿主能力；缺哪个就静默降级，不让页面白屏。 */
export interface VibeHost {
  http: DataTransport
  /** 重新取数（`reload` 动作）。 */
  reload?: () => void
  /** 打开详情（`dialog` 动作）。 */
  openDetail?: (row: Row) => void
  /** 页面跳转（`navigate` 动作），缺省用 `location.assign`。 */
  navigate?: (path: string) => void
  /** 提示（动作缺参数、请求失败）。 */
  notify?: (message: string, kind: 'success' | 'error' | 'warning') => void
  /** 对外派发（`emit` 动作）：宿主可挂到总线或埋点上。 */
  dispatch?: (event: { channel: string; payload: unknown; row: Row }) => void
}

/** 模板里的一个方法：`onClick` / `onChange`。 */
export type VibeHandler = (payload?: unknown) => void

const VIBE_HOST: InjectionKey<VibeHost> = Symbol('data-page-element:vibe-host')

/** 页壳装配一次，叶子组件（列/查询/字段/动作）就地取用。 */
export function provideVibeHost(host: VibeHost): void {
  provide(VIBE_HOST, host)
}

/** 取宿主能力；没有装配时返回 `null`，叶子组件退化成不做事而不是崩掉。 */
export function useVibeHost(): VibeHost | null {
  return inject(VIBE_HOST, null)
}

/**
 * 合成一个槽位的处理器表：通道名 → 函数。
 *
 * `defaults` 是该槽位「不配也合理」的行为（单元格看详情、控件回写值），
 * 元素显式声明的事件绑定覆盖它。因此模板里写 `@click="onClick"` 在两种情况下都有效：
 * 配了动作就执行动作，没配就走默认行为——不会出现「写着有事件、点了没反应」。
 */
export function vibeHandlers(
  vibe: VibeSchema | undefined,
  host: VibeHost | null,
  row: Row = {},
  defaults: Record<string, VibeHandler> = {},
): Record<string, VibeHandler> {
  const handlers: Record<string, VibeHandler> = { ...defaults }
  for (const binding of vibe?.bindings ?? []) {
    if (binding.kind !== 'event') continue
    if (!binding.action) continue
    if (binding.when && !matchCondition(row, binding.when)) continue
    handlers[binding.channel] = (payload?: unknown) => {
      void runBinding(binding, host, row, payload)
    }
  }
  return handlers
}

/** 执行一条事件绑定；参数缺失与请求失败都走宿主提示，不静默。 */
async function runBinding(
  binding: VibeBindingSchema,
  host: VibeHost | null,
  row: Row,
  payload: unknown,
): Promise<void> {
  const params = binding.params ?? {}
  switch (binding.action) {
    case 'reload':
      host?.reload?.()
      return
    case 'dialog':
      host?.openDetail?.(row)
      return
    case 'emit':
      host?.dispatch?.({ channel: binding.channel, payload, row })
      return
    case 'navigate': {
      const path = interpolate(String(params.path ?? ''), row)
      if (!path) {
        host?.notify?.(`跳转动作缺少 params.path（通道 ${binding.channel}）`, 'warning')
        return
      }
      if (host?.navigate) host.navigate(path)
      else if (typeof window !== 'undefined') window.location.assign(path)
      return
    }
    case 'request': {
      if (!host) {
        return
      }
      const path = interpolate(String(params.path ?? ''), row)
      if (!path) {
        host.notify?.(`请求动作缺少 params.path（通道 ${binding.channel}）`, 'warning')
        return
      }
      const body = params.body === undefined ? payload : params.body
      try {
        await host.http.request(path, {
          method: String(params.method ?? 'POST'),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        host.notify?.('操作成功', 'success')
        host.reload?.()
      } catch (cause) {
        host.notify?.(cause instanceof Error ? cause.message : String(cause), 'error')
      }
      return
    }
    default:
      return
  }
}
