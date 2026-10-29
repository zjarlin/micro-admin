// 传输端口：页面层唯一的外部依赖。
//
// 只声明「怎么发一个请求」和「分页结果长什么样」，不绑定 fetch / axios / Tauri / Electron，
// 也不假设同源或路径前缀。宿主注入实现，因此同一个引擎能跑在浏览器、Node、桌面壳里。
//
// 契约（与仓库内 `server/` 的 HTTP 外壳一致）：
// - 成功：resolve 业务数据本身（已剥掉 `{ code, message, data }` 信封）；
// - 失败：reject 一个 `Error`，其 `message` 直接可展示。

/** 分页请求参数（旧式查询串的形状，留给宿主的快捷查询用）。 */
export interface PageQuery {
  page: number
  pageSize: number
  keyword?: string
  status?: string
}

/** 分页结果。 */
export interface PageResult<T> {
  rows: T[]
  total: number
}

/** 传输端口：页面层看得到的全部网络能力。 */
export interface DataTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>
}

/** 从任意「返回数据」的函数适配一个传输端口（便于测试与 mock）。 */
export function transportOf(handler: (path: string, init?: RequestInit) => Promise<unknown>): DataTransport {
  return {
    request: <T>(path: string, init?: RequestInit) => handler(path, init) as Promise<T>,
  }
}
