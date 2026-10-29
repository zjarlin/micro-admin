// 跨资源引用：把「选项来自哪里」「这一列展示哪个字段」变成一次取数。
//
// 页面只需要在 schema 里写 `optionsFrom` / `resolveFrom`，壳负责按端点取数并缓存；
// 同一端点只请求一次，左树与下拉共用同一份数据。
import { ref, shallowRef } from 'vue'
import type { HttpClient } from '../http.ts'
import type { ColumnSchema, CrudPageSchema, FieldOption, FieldSchema, Row } from './schema.ts'

export interface ReferenceState {
  readonly loading: boolean
  load(): Promise<void>
  /** `optionsFrom` 字段的下拉选项。 */
  optionsOf(field: FieldSchema): FieldOption[] | undefined
  /** `resolveFrom` 列的展示值；不是外键列时返回 `undefined`。 */
  resolveOf(column: ColumnSchema, row: Row): string | undefined
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function useReferences(http: HttpClient, schema: CrudPageSchema): ReferenceState {
  const cache = shallowRef<Record<string, Row[]>>({})
  const loading = ref(false)

  function endpoints(): string[] {
    const list = new Set<string>()
    for (const field of schema.fields ?? []) {
      if (field.optionsFrom) list.add(field.optionsFrom.endpoint)
    }
    for (const column of schema.columns) {
      if (column.resolveFrom) list.add(column.resolveFrom.endpoint)
    }
    return [...list]
  }

  async function load(): Promise<void> {
    const pending = endpoints().filter((endpoint) => cache.value[endpoint] === undefined)
    if (!pending.length) return
    loading.value = true
    try {
      const results = await Promise.all(
        pending.map(async (endpoint) => {
          const payload = await http.request<Row[] | { rows: Row[] }>(endpoint)
          const rows = Array.isArray(payload) ? payload : payload.rows
          return [endpoint, rows] as const
        }),
      )
      // 逐项写入，避免并发页面重复请求同一端点时互相覆盖。
      const next = { ...cache.value }
      for (const [endpoint, rows] of results) next[endpoint] = rows
      cache.value = next
    } catch {
      // 引用源不可用不应让整页报错：下拉退化为空，列退回原始 id。
      cache.value = { ...cache.value }
    } finally {
      loading.value = false
    }
  }

  function optionsOf(field: FieldSchema): FieldOption[] | undefined {
    const source = field.optionsFrom
    if (!source) return undefined
    const rows = cache.value[source.endpoint] ?? []
    const valueProp = source.valueProp ?? 'id'
    const labelProp = source.labelProp ?? 'name'
    return rows.map((row) => ({
      label: textOf(row[labelProp]) || textOf(row[valueProp]),
      value: row[valueProp] as string | number,
    }))
  }

  function resolveOf(column: ColumnSchema, row: Row): string | undefined {
    const source = column.resolveFrom
    if (!source) return undefined
    const rows = cache.value[source.endpoint] ?? []
    const keyProp = source.keyProp ?? 'id'
    const labelProp = source.labelProp ?? 'name'
    const key = textOf(row[column.prop])
    if (!key) return undefined
    const match = rows.find((item) => textOf(item[keyProp]) === key)
    return match ? textOf(match[labelProp]) : undefined
  }

  return {
    get loading() { return loading.value },
    load,
    optionsOf,
    resolveOf,
  }
}
