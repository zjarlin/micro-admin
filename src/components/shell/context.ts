// 外壳渲染上下文：把「当前是谁、在哪一页、菜单长什么样」与「外壳元素长什么样」分开。
//
// 为什么要有它：外壳元素视图（`ShellElementView`）既要给设计器画布用（示例数据），
// 又要给运行期外壳用（真实数据）。把上下文抽成一个普通对象后，两处共用同一个组件，
// 设计器预览与上线外壳永远是同一份渲染实现——这就是外壳版的「所见即所得」。
import type { ShellItem } from '@/shared/shell'

/** 菜单分组：与内核菜单贡献同一形状，设计器用示例数据，运行期用真实菜单。 */
export interface ShellMenuItem {
  id: string
  title: string
  path: string
  icon?: string
  badge?: string
}

export interface ShellMenuGroup {
  name: string
  items: ShellMenuItem[]
}

export interface ShellViewUser {
  name: string
  department: string
  /** 头像里的缩写（一个或两个字）。 */
  initials: string
}

/** 外壳渲染上下文：单一来源，设计期与运行期只是取值不同。 */
export interface ShellViewContext {
  /** `design`：画布里的示例态；`runtime`：真实外壳。 */
  mode: 'design' | 'runtime'
  /** 侧栏是否收起（图标旁是否隐藏文案）。 */
  collapsed: boolean
  /** 当前路由路径（菜单高亮、面包屑用）。 */
  activePath: string
  /** 当前页面标题（面包屑用）。 */
  pageTitle: string
  /** 是否深色主题（主题图标用）。 */
  dark: boolean
  /** 当前用户（用户区用）。 */
  user: ShellViewUser
  /** 菜单分组（菜单角色用）。 */
  groups: ShellMenuGroup[]
  /** 菜单关键字（菜单搜索用，双向）。 */
  keyword: string
}

/** 设计器画布用的示例上下文：结构像真机，值一眼看出是示例。 */
export function designContext(): ShellViewContext {
  return {
    mode: 'design',
    collapsed: false,
    activePath: '/dashboard',
    pageTitle: '用户管理',
    dark: false,
    user: { name: '超级管理员', department: '平台研发部', initials: '超' },
    groups: [
      {
        name: '概览',
        items: [
          { id: 'menu-dashboard', title: '工作台', path: '/dashboard', icon: 'HomeFilled' },
          { id: 'menu-plugins', title: '插件中心', path: '/plugins', icon: 'Grid' },
        ],
      },
      {
        name: '系统管理',
        items: [
          { id: 'sys-user', title: '用户管理', path: '/system/user', icon: 'User' },
          { id: 'sys-role', title: '角色管理', path: '/system/role', icon: 'UserFilled' },
          { id: 'sys-menu', title: '菜单管理', path: '/system/menu', icon: 'Menu' },
        ],
      },
    ],
    keyword: '',
  }
}

/** 一个外壳条目是否可点击（图标/用户/收起这类入口；纯文本、菜单块本身不是入口）。 */
export function shellItemClickable(item: ShellItem): boolean {
  return Boolean(item.action) || Boolean(item.code)
}
