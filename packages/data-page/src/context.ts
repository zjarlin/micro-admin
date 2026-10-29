// 宿主注入点：壳组件从这里拿传输实现，而不是直接 import 宿主的 http 客户端。
//
// 宿主在 setup 里 `provideDataTransport(http)` 一次，页面组件不需要逐个透传；
// 需要临时换实现（测试、只读预览）时给组件传 `transport` prop 即可。
import { inject, provide, type InjectionKey } from 'vue'
import type { DataTransport } from './transport.ts'

export const DATA_TRANSPORT_KEY: InjectionKey<DataTransport> = Symbol('data-page-transport')

/** 宿主调用：把传输实现提供给子树里的通用页面壳。 */
export function provideDataTransport(transport: DataTransport): void {
  provide(DATA_TRANSPORT_KEY, transport)
}

/** 组件调用：取当前传输实现；未提供时返回 `null` 由调用方决定报错还是退化。 */
export function useDataTransport(): DataTransport | null {
  return inject(DATA_TRANSPORT_KEY, null)
}
