// 左树状态机：加载、建树、搜索、选中。
//
// 选中结果通过回调交给列表页写入查询参数，本模块不直接改列表状态，
// 保证「树」和「表」两块可以独立使用（只有表、只有树、或两者组合）。
import { computed, ref, shallowRef } from 'vue'
import type { DataTransport } from './transport.ts'
import type { Row, TreeSchema } from './schema.ts'
import { buildTree, filterTree, pathToNode, type TreeNode } from './tree.ts'

export interface TreeState<T> {
  readonly nodes: TreeNode<T>[]
  readonly flat: T[]
  readonly loading: boolean
  readonly error: string | null
  readonly selectedId: string
  readonly keyword: string
  readonly expandedKeys: string[]
  readonly schema: TreeSchema
  load(): Promise<void>
  select(id: string): void
  setKeyword(value: string): void
  expandAll(): void
  collapseAll(): void
  /** 展开到指定节点，远程定位时使用。 */
  reveal(id: string): void
  labelOf(id: string): string
}

export function useTree<T extends Row>(
  http: DataTransport,
  schema: TreeSchema,
  onSelect?: (row: T | null) => void,
): TreeState<T> {
  const raw = shallowRef<T[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedId = ref('')
  const keyword = ref('')
  const expandedKeys = ref<string[]>([])

  const nodes = computed<TreeNode<T>[]>(() => {
    const built = buildTree(raw.value, {
      idProp: schema.idProp,
      parentProp: schema.parentProp,
      childrenProp: schema.childrenProp ?? 'children',
    })
    const needle = keyword.value.trim().toLowerCase()
    if (!needle) return built
    return filterTree(built, (row) =>
      [row[schema.labelProp], schema.captionProp ? row[schema.captionProp] : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  })

  /** 当前树形结果的全部节点 id，供「展开全部」使用。 */
  function collectKeys(list: TreeNode<T>[]): string[] {
    const keys: string[] = []
    const walk = (items: TreeNode<T>[]): void => {
      for (const node of items) {
        keys.push(String(node.raw[schema.idProp] ?? ''))
        walk(node.children)
      }
    }
    walk(list)
    return keys
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const payload = await http.request<T[]>(schema.endpoint)
      raw.value = Array.isArray(payload) ? payload : []
      const all = buildTree(raw.value, {
        idProp: schema.idProp,
        parentProp: schema.parentProp,
        childrenProp: schema.childrenProp ?? 'children',
      })
      expandedKeys.value = collectKeys(all)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      raw.value = []
    } finally {
      loading.value = false
    }
  }

  function select(id: string): void {
    selectedId.value = id
    if (!id) {
      onSelect?.(null)
      return
    }
    const found = raw.value.find((row) => String(row[schema.idProp]) === id) ?? null
    onSelect?.(found)
  }

  function setKeyword(value: string): void {
    keyword.value = value
  }

  function expandAll(): void {
    expandedKeys.value = collectKeys(nodes.value)
  }

  function collapseAll(): void {
    expandedKeys.value = []
  }

  function labelOf(id: string): string {
    const row = raw.value.find((item) => String(item[schema.idProp]) === id)
    return row ? String(row[schema.labelProp] ?? '') : ''
  }

  /** 展开到指定节点，选中远程节点时使用。 */
  function reveal(id: string): void {
    const path = pathToNode(nodes.value, { idProp: schema.idProp, parentProp: schema.parentProp }, id)
    expandedKeys.value = [...new Set([...expandedKeys.value, ...path])]
  }

  return {
    get nodes() { return nodes.value },
    get flat() { return raw.value },
    get loading() { return loading.value },
    get error() { return error.value },
    get selectedId() { return selectedId.value },
    get keyword() { return keyword.value },
    get expandedKeys() { return expandedKeys.value },
    schema,
    load,
    select,
    setKeyword,
    expandAll,
    collapseAll,
    reveal,
    labelOf,
  }
}
