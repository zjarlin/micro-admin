// 壳层取传输实现：组件 prop 优先，其次宿主 provide，都没有就明确报错。
//
// 报错而不是静默退化：配置驱动的页面拿不到数据却显示空表，比直接抛错难排查得多。
import type { DataTransport } from '@zjarlin/data-page'
import { useDataTransport } from '@zjarlin/data-page'

export function resolveTransport(prop?: DataTransport | undefined): DataTransport {
  if (prop) return prop
  const injected = useDataTransport()
  if (injected) return injected
  throw new Error('data-page: 未提供传输实现；请在宿主 provideDataTransport(http)，或给组件传 transport prop')
}
