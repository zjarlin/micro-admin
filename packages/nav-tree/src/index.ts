// 任意层级导航树门面：纯函数 + 一个无业务依赖的渲染组件。
import NavTree from './NavTree.vue'

export { NavTree }
export { ancestorsOf, buildForest, countLeaves, filterForest, flatten } from './tree.ts'
export type { BuildOptions, NavItem, NavNode, NavRow } from './types.ts'
