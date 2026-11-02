// 装配 → 展开 → 过滤 → 拍平：四个纯函数，没有 Vue、没有 store、没有路由。
//
// 「任意层级」的关键在装配：声明是扁平的（`parent` 指 id），父节点可能比子节点后注册，
// 所以必须两遍——先建索引，再挂接。挂接时遇到悬空 parent 就把该节点提为顶层，
// 不让一条写坏的声明把整棵菜单弄丢。
import type { BuildOptions, NavItem, NavNode, NavRow } from './types.ts'

function byOrder(a: NavNode, b: NavNode): number {
  return a.order - b.order || a.title.localeCompare(b.title, 'zh-Hans-CN')
}

/**
 * 把扁平声明装成森林。
 *
 * 装配规则（顺序即优先级）：
 * 1. `parent` 有值且父节点存在 → 挂到父节点下（可无限层）；
 * 2. 否则有 `group` → 挂到该分组的自动目录下；
 * 3. 其余成为顶层。
 */
export function buildForest(items: readonly NavItem[], options: BuildOptions = {}): NavNode[] {
  const prefix = options.groupIdPrefix ?? 'group:'
  const groupOrder = options.groupOrder ?? []
  const index = new Map<string, NavNode>()
  const parentOf = new Map<string, string>()
  const groups = new Map<string, NavNode>()
  const roots: NavNode[] = []

  // 第一遍：所有节点先独立成对象（父可能比子晚进来，挂接只认对象引用，与顺序无关）。
  for (const item of items) {
    if (item.hidden) continue
    index.set(item.id, {
      id: item.id,
      title: item.title,
      kind: item.folder ? 'folder' : 'item',
      ...(item.path && !item.folder ? { path: item.path } : {}),
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.badge ? { badge: item.badge } : {}),
      order: item.order ?? 100,
      children: [],
    })
    if (item.parent) parentOf.set(item.id, item.parent)
  }

  const groupNode = (name: string): NavNode => {
    const existing = groups.get(name)
    if (existing) return existing
    const rank = groupOrder.indexOf(name)
    const node: NavNode = {
      id: `${prefix}${name}`,
      title: options.groupLabel?.(name) ?? name,
      kind: 'group',
      order: rank >= 0 ? rank * 10 : 900 + groups.size,
      children: [],
    }
    groups.set(name, node)
    return node
  }

  // 第二遍：挂接。优先级 parent > group > 顶层；父不存在就把子提为顶层。
  for (const item of items) {
    if (item.hidden) continue
    const node = index.get(item.id)!
    const explicit = parentOf.get(item.id)
    const parent = explicit ? index.get(explicit) : undefined
    if (parent) {
      parent.children.push(node)
      continue
    }
    if (item.group) {
      groupNode(item.group).children.push(node)
      continue
    }
    roots.push(node)
  }

  const sortDeep = (nodes: NavNode[]): void => {
    nodes.sort(byOrder)
    for (const node of nodes) {
      sortDeep(node.children)
      // 有子项的菜单自动成为目录：避免「看着是叶子、点了无处可去」。
      if (node.children.length > 0 && node.kind === 'item') {
        node.kind = 'folder'
        delete node.path
      }
    }
  }

  // 分组目录只保留有内容的那些，避免空分组占位。
  for (const [name, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.children.length === 0) {
      groups.delete(name)
      continue
    }
    roots.push(group)
  }

  sortDeep(roots)
  return roots
}

/** 叶子的祖先 id 链（由根到父），用于「进入页面时自动展开所在分支」。 */
export function ancestorsOf(forest: readonly NavNode[], predicate: (node: NavNode) => boolean): string[] {
  const trail: string[] = []
  const walk = (nodes: readonly NavNode[], path: string[]): boolean => {
    for (const node of nodes) {
      if (predicate(node)) {
        trail.push(...path)
        return true
      }
      if (node.children.length > 0 && walk(node.children, [...path, node.id])) return true
    }
    return false
  }
  walk(forest, [])
  return trail
}

/**
 * 按关键字过滤森林：命中项保留，且保留它的整条祖先链；
 * 命中目录本身时保留其全部子项（搜「系统」应当展开整个系统管理）。
 */
export function filterForest(forest: readonly NavNode[], keyword: string): NavNode[] {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return [...forest]
  const keep = (node: NavNode): NavNode | null => {
    const selfHit = node.title.toLowerCase().includes(needle)
    const children = node.children.map(keep).filter((child): child is NavNode => child !== null)
    if (selfHit) return { ...node, children: node.children }
    if (children.length > 0) return { ...node, children }
    return null
  }
  return forest.map(keep).filter((node): node is NavNode => node !== null)
}

/**
 * 拍平成渲染行。
 *
 * - 默认展开：目录节点的 `expanded` 由调用方给的集合决定，集合里没有就走默认值；
 * - 折叠只影响子行，目录行本身始终可见（用户要能再点开）。
 */
export function flatten(
  forest: readonly NavNode[],
  options: { expanded?: ReadonlySet<string>; activePath?: string; defaultExpanded?: boolean } = {},
): NavRow[] {
  const { expanded, activePath, defaultExpanded = true } = options
  const rows: NavRow[] = []
  const walk = (nodes: readonly NavNode[], depth: number): void => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0
      const isExpanded = hasChildren && (expanded ? expanded.has(node.id) : defaultExpanded)
      rows.push({
        node,
        depth,
        hasChildren,
        expanded: isExpanded,
        active: Boolean(node.path) && node.path === activePath,
      })
      if (hasChildren && isExpanded) walk(node.children, depth + 1)
    }
  }
  walk(forest, 0)
  return rows
}

/** 统计叶子数量（分组标题右侧的计数）。 */
export function countLeaves(node: NavNode): number {
  if (node.children.length === 0) return node.kind === 'item' ? 1 : 0
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0)
}
