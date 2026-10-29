// 分页查询状态机：schema 驱动的列表页数据层。
//
// 与旧 `useCrud` 的区别：
// - 查询条件由 `schema.query` 声明，不再写死 `{ keyword, status }`；
// - 支持附加固定参数（如左树选中的 `parentId`）；
// - 暴露 `setFilter` 给左树写入选中值。
import { reactive, ref, shallowRef } from 'vue'
import type { HttpClient } from '../http.ts'
import type { CrudPageSchema } from './schema.ts'
import type { PageResult } from '../types.ts'

export interface PageState<T> {
  readonly rows: T[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  /** 供 `v-model:current-page` 使用的可写视图。 */
  currentPage: number
  /** 供 `v-model:page-size` 使用的可写视图。 */
  currentSize: number
  readonly loading: boolean
  readonly error: string | null
  readonly filters: Record<string, string>
  load(): Promise<void>
  search(): void
  reset(): void
  changePage(page: number): void
  changeSize(size: number): void
  setFilter(prop: string, value: string): void
}

/** 查询字段的初始值：全部空串，代表「不参与筛选」。 */
/** 查询条件 + 左树选中值的初始状态，统一从这里产出。 */
export function initialFilters(schema: CrudPageSchema): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const item of schema.query ?? []) filters[item.prop] = ''
  // 左树选中值不写在 `query` 里（它不是输入框），但同样要参与查询串。
  if (schema.tree) filters[schema.tree.param] = ''
  return filters
}

function buildQueryString(
  schema: CrudPageSchema,
  filters: Record<string, string>,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  for (const [key, value] of Object.entries(schema.params ?? {})) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  for (const item of schema.query ?? []) {
    const value = filters[item.prop]
    if (value === undefined || value === '') continue
    params.set(item.param ?? item.prop, value)
  }
  // 之前这里漏掉了左树参数：树上点选不会带 `deptId`，列表看起来「点了没反应」。
  const treeParam = schema.tree?.param
  if (treeParam) {
    const value = filters[treeParam]
    if (value !== undefined && value !== '') params.set(treeParam, value)
  }
  return params.toString()
}

export function usePage<T>(
  http: HttpClient,
  schema: CrudPageSchema,
  options: { immediate?: boolean } = {},
): PageState<T> {
  const rows = shallowRef<T[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(schema.pageSize ?? 10)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = reactive<Record<string, string>>(initialFilters(schema))

  // 同一页面连续切换筛选会并发请求，用序号丢弃过期响应。
  let requestToken = 0

  async function load(): Promise<void> {
    const token = ++requestToken
    loading.value = true
    error.value = null
    try {
      const query = buildQueryString(schema, filters, page.value, pageSize.value)
      const result = await http.request<PageResult<T>>(`${schema.endpoint}?${query}`)
      if (token !== requestToken) return
      rows.value = result.rows
      total.value = result.total
    } catch (cause) {
      if (token !== requestToken) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      rows.value = []
      total.value = 0
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  function search(): void {
    page.value = 1
    void load()
  }

  function reset(): void {
    for (const key of Object.keys(filters)) filters[key] = ''
    search()
  }

  function changePage(next: number): void {
    page.value = Math.max(1, next)
    void load()
  }

  function changeSize(size: number): void {
    pageSize.value = size
    page.value = 1
    void load()
  }

  function setFilter(prop: string, value: string): void {
    filters[prop] = value
    search()
  }

  if (options.immediate === true) void load()

  return {
    get rows() { return rows.value },
    get total() { return total.value },
    get page() { return page.value },
    get pageSize() { return pageSize.value },
    get currentPage() { return page.value },
    set currentPage(next: number) {
      // 分页组件在挂载时也会回写一次，值没变就不要重复请求。
      if (next !== page.value) changePage(next)
    },
    get currentSize() { return pageSize.value },
    set currentSize(next: number) {
      if (next !== pageSize.value) changeSize(next)
    },
    get loading() { return loading.value },
    get error() { return error.value },
    filters,
    load,
    search,
    reset,
    changePage,
    changeSize,
    setFilter,
  }
}
