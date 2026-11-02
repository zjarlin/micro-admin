// 导航树的数据契约：只有「扁平声明」和「渲染行」两种形状。
//
// 声明侧刻意保持扁平（`parent` 指向另一个 id），因为插件是各自独立注册的：
// 谁也不知道别人先注册了哪个父节点，扁平表才能在装配阶段拼成任意深度。
// 组件侧只认「已求解好的行」，渲染时不再递归判断，滚动/虚拟化也好接管。

/** 一条导航声明（插件贡献的原始形状，与内核 `MenuContribution` 同构）。 */
export interface NavItem {
  id: string
  title: string
  /** 分组标题（一级节点）；未指定时归入「其他」。 */
  group?: string
  /** 父节点 id：有值时挂到该节点下面，因此层级不限。 */
  parent?: string
  /** 目录节点：只有子项、自身不可点。 */
  folder?: boolean
  path?: string
  icon?: string
  badge?: string
  order?: number
  hidden?: boolean
}

/** 一棵装配好的树。 */
export interface NavNode {
  id: string
  title: string
  /** group = 分组标题行；folder = 可折叠目录；item = 叶子页面。 */
  kind: 'group' | 'folder' | 'item'
  path?: string
  icon?: string
  badge?: string
  order: number
  children: NavNode[]
}

/** 一行可见内容（扁平化之后的渲染单位）。 */
export interface NavRow {
  node: NavNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  active: boolean
}

export interface BuildOptions {
  /** 分组在侧栏中的固定顺序；未列出的分组排在后面，按标题排序。 */
  groupOrder?: readonly string[]
  /** 分组标题的显示名（例如把 `概览` 渲染成 `OVERVIEW`）。 */
  groupLabel?: (group: string) => string
  /** 分组节点的 id 前缀，避免与业务菜单 id 撞车。 */
  groupIdPrefix?: string
}
