import { reactive, ref, shallowRef } from 'vue'
import type { HttpClient } from './http'
import type { PageResult } from './types'

export interface CrudOptions {
  endpoint: string
  pageSize?: number
  transformQuery?: (query: Record<string, string | number>) => Record<string, string | number>
}

export interface CrudResult<T> {
  /** 返回解包后的值，模板与脚本都能直接当作数组/数字使用。 */
  readonly rows: T[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly loading: boolean
  readonly error: string | null
  query: Record<string, string>
  load(): Promise<void>
  search(): void
  changePage(page: number): void
  changeSize(size: number): void
}

export function useCrud<T>(http: HttpClient, options: CrudOptions): CrudResult<T> {
  const rows = shallowRef<T[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(options.pageSize ?? 10)
  const query = reactive<Record<string, string>>({ keyword: '', status: '' })

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      params.set('page', String(page.value))
      params.set('pageSize', String(pageSize.value))
      for (const [key, value] of Object.entries(query)) if (value !== '') params.set(key, value)
      const result = await http.request<PageResult<T>>(`${options.endpoint}?${params.toString()}`)
      rows.value = result.rows
      total.value = result.total
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      rows.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  function search(): void {
    page.value = 1
    void load()
  }

  function changePage(next: number): void {
    page.value = next
    void load()
  }

  function changeSize(size: number): void {
    pageSize.value = size
    page.value = 1
    void load()
  }

  const view: CrudResult<T> = {
    get rows() { return rows.value },
    get total() { return total.value },
    get page() { return page.value },
    get pageSize() { return pageSize.value },
    get loading() { return loading.value },
    get error() { return error.value },
    query,
    load,
    search,
    changePage,
    changeSize,
  }
  return view
}
