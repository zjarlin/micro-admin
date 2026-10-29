// 树工具：扁平表建树、递归过滤、扁平化。纯函数，不依赖任何 UI 库。
//
// 左树右表两种后端形状都支持：
// - 扁平：返回 `[{ id, parentId, name }]`，由 `parentProp` 客户端建树；
// - 嵌套：返回 `[{ id, name, children: [...] }]`，直接使用。

/** 树节点：原始行 + 子节点数组。 */
export interface TreeNode<T> {
  raw: T
  children: TreeNode<T>[]
}

export interface BuildTreeOptions<T> {
  idProp: keyof T & string
  /** 给了就按父子关系建树；不给则视为已嵌套（读 `childrenProp`）。 */
  parentProp?: (keyof T & string) | undefined
  childrenProp?: string
  /** 父节点缺失时是否提升为根；缺省 `true`，避免孤儿节点消失。 */
  promoteOrphans?: boolean
}

function keyOf(value: unknown): string {
  return String(value ?? '')
}

/**
 * 建树。
 *
 * 顺序保持输入顺序，父节点缺失的节点按 `promoteOrphans` 提升为根节点，
 * 因此后端返回乱序或含孤儿节点时也不会静默丢数据。
 */
export function buildTree<T extends Record<string, unknown>>(
  rows: T[],
  options: BuildTreeOptions<T>,
): TreeNode<T>[] {
  const childrenProp = options.childrenProp ?? 'children'

  if (!options.parentProp) {
    return rows.map((row) => ({
      raw: row,
      children: Array.isArray(row[childrenProp])
        ? buildTree(row[childrenProp] as T[], { ...options, childrenProp })
        : [],
    }))
  }

  const nodes = new Map<string, TreeNode<T>>()
  for (const row of rows) nodes.set(keyOf(row[options.idProp]), { raw: row, children: [] })

  const roots: TreeNode<T>[] = []
  for (const row of rows) {
    const node = nodes.get(keyOf(row[options.idProp]))
    if (!node) continue
    const parentKey = row[options.parentProp]
    const parent = parentKey === null || parentKey === undefined ? undefined : nodes.get(keyOf(parentKey))
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  // 父指针成环时上面会把整个环挂到某个节点下，这里把不可达节点补回根，避免整棵子树消失。
  if (nodes.size !== countReachable(roots)) {
    const reachable = new Set<TreeNode<T>>()
    const walk = (list: TreeNode<T>[]): void => {
      for (const node of list) {
        if (reachable.has(node)) continue
        reachable.add(node)
        walk(node.children)
      }
    }
    walk(roots)
    for (const node of nodes.values()) if (!reachable.has(node)) roots.push(node)
  }

  return roots
}

function countReachable<T>(roots: TreeNode<T>[]): number {
  const seen = new Set<TreeNode<T>>()
  const stack = [...roots]
  while (stack.length) {
    const node = stack.pop()
    if (!node || seen.has(node)) continue
    seen.add(node)
    stack.push(...node.children)
  }
  return seen.size
}

/** 递归过滤：命中节点的祖先链保留，保证搜索结果不被层级藏起来。 */
export function filterTree<T>(
  nodes: TreeNode<T>[],
  matches: (raw: T) => boolean,
): TreeNode<T>[] {
  const result: TreeNode<T>[] = []
  for (const node of nodes) {
    const children = filterTree(node.children, matches)
    if (matches(node.raw) || children.length) result.push({ raw: node.raw, children })
  }
  return result
}

/** 展平成行数组，用于「树形表格」这类需要一次性交给表格组件的数据。 */
export function flattenTree<T>(nodes: TreeNode<T>[]): T[] {
  const rows: T[] = []
  const walk = (list: TreeNode<T>[]): void => {
    for (const node of list) {
      rows.push(node.raw)
      walk(node.children)
    }
  }
  walk(nodes)
  return rows
}

/** 找出从根到目标的节点 id 链，用于「选中节点时自动展开父级」。 */
export function pathToNode<T>(
  nodes: TreeNode<T>[],
  options: BuildTreeOptions<T>,
  id: unknown,
): string[] {
  const target = keyOf(id)
  const path: string[] = []
  const walk = (list: TreeNode<T>[]): boolean => {
    for (const node of list) {
      const key = keyOf(node.raw[options.idProp])
      path.push(key)
      if (key === target) return true
      if (walk(node.children)) return true
      path.pop()
    }
    return false
  }
  return walk(nodes) ? path : []
}
