// 外壳图纸（Shell Drawing）：把「后台外壳长什么样」也变成一份可画、可编译、可下发的 JSON。
//
// 与页面图纸（`UiDrawing` → `CrudPageSchema`）同源同构，但产出的是**外壳 schema**：
// 侧栏品牌、菜单、搜索、收起按钮、顶栏图标行、面包屑、用户区、内容区。
// 因为外壳不再是写死在 `AdminLayout.vue` 里的模板，所以：
// 1. 顶栏/侧栏的每个图标都是一等元素，点击事件（跳转/请求/命令/派发/弹窗）在画布上配；
// 2. 每个元素都能带一段 `code` 模板（vibeelement），在画布上即时改、即时看到；
// 3. 整套外壳随图纸存进后端、下发给任意壳，零代码改外壳。
//
// 约束与页面图纸一致：只含 string|number|boolean|数组|对象，没有函数、没有 VNode。

import type { VibeBindingSchema, VibeSchema } from '@zjarlin/data-page/schema'
import type { UiCanvasSettings, UiDiagnostic, UiQuestion, UiRect } from './types.ts'
import { centerOf, containsPoint } from './layout.ts'

/** 外壳元素语义角色：三层——区域容器 / 区域元素 / 装饰。 */
export type ShellRole =
  // 区域容器
  | 'shell'
  | 'sidebar'
  | 'topbar'
  | 'content'
  // 侧栏元素
  | 'brand'
  | 'menu'
  | 'menu-search'
  | 'collapse'
  // 顶栏元素
  | 'breadcrumb'
  | 'icon'
  | 'user'
  | 'tabs'
  // 装饰
  | 'text'
  | 'divider'

/** 外壳元素的点击语义：与页面动作同构，但动作集更贴近外壳（命令 / 派发）。 */
export type ShellActionKind = 'navigate' | 'request' | 'command' | 'emit' | 'dialog' | 'none'

export interface ShellAction {
  kind: ShellActionKind
  /**
   * 动作参数：
   * - `navigate` 用 `path`；
   * - `request` 用 `method` / `path` / `body`；
   * - `command` 用 `name`（内核命令名，如 `shell.toggle-theme`）与 `args`；
   * - `emit` 用 `event` 与 `payload`。
   */
  params?: Record<string, unknown>
  /** 二次确认文案；给了就先弹确认。 */
  confirm?: string
}

/** 外壳元素可配置属性：每一项都是「配到极致」的落点，且都能被编译器读走。 */
export interface ShellElementProps {
  // ---- 通用 ----
  /** 文案：品牌标题、图标 tooltip、菜单分组名等。 */
  label?: string
  /** Element Plus 图标名（`Sunny` / `Bell` / `Setting` …）。 */
  icon?: string
  /** 悬停提示；缺省用 label。 */
  tooltip?: string
  /** 权限码：不给或无权限时该元素不渲染。 */
  permission?: string
  /** 强调色：按钮/选中态。 */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  /** 图标旁是否显示文案（窄屏由外壳自动收起）。 */
  showLabel?: boolean
  /** 角标（红点数、未读数）。 */
  badge?: string
  // ---- 品牌 / 侧栏 ----
  /** 品牌主标题。 */
  brandTitle?: string
  /** 品牌副标题。 */
  brandSubtitle?: string
  /** Logo 文字（方块里的短字，如 `MK`）。 */
  logoText?: string
  /** 侧栏正常宽度（px）。 */
  width?: number
  /** 侧栏收起宽度（px）。 */
  collapsedWidth?: number
  /** 初始是否收起。 */
  collapsed?: boolean
  /** 底色。 */
  bg?: string
  /** 文字色。 */
  textColor?: string
  /** 侧栏选中项强调条色 / 顶栏强调色。 */
  accent?: string
  // ---- 顶栏 ----
  /** 顶栏高度（px）。 */
  height?: number
  /** 顶栏元素靠左还是靠右（不写按几何横向中线自动分）。 */
  align?: 'left' | 'right'
  // ---- 内容区 ----
  /** 是否为全出血页（设计器/运行预览）去掉内边距。 */
  fullBleed?: boolean
  /**
   * vibeelement 模板片段：只允许插值与已注册组件，禁 `<script>` / `v-html` / 内联表达式。
   * 与页面元素同一份安全检查（`inspectCode`），因为它同样会被下发、被执行。
   */
  code?: string
}

/** 外壳元素绑定：数据通道读，事件通道写（点击）。动作集比页面动作多了命令/派发。 */
export interface ShellBinding {
  kind: 'data' | 'event'
  channel: string
  source?: string
  map?: Record<string, string>
  action?: ShellActionKind
  params?: Record<string, unknown>
  confirm?: string
  when?: unknown
}

/** 外壳图纸上的一个元素实例。 */
export interface ShellElement {
  id: string
  role: ShellRole
  rect: UiRect
  zIndex: number
  text: string
  props: ShellElementProps
  bindings: ShellBinding[]
  locked: boolean
  visible: boolean
}

/** 外壳图纸元信息。 */
export interface ShellDrawingMeta {
  /** 外壳 key，发布后即 `/shell/config` 返回的标识（通常只有一个 `shell.default`）。 */
  key: string
  title: string
  description?: string
}

/** 一份外壳图纸：设计师交付的就是它，它编译出的就是运行期外壳。 */
export interface ShellDrawing {
  version: number
  meta: ShellDrawingMeta
  canvas: UiCanvasSettings
  elements: ShellElement[]
}

/** 编译后的外壳条目：运行期一个图标/一块内容就是一条。 */
export interface ShellItem {
  id: string
  role: ShellRole
  label?: string
  icon?: string
  tooltip?: string
  permission?: string
  variant?: ShellElementProps['variant']
  showLabel?: boolean
  badge?: string
  /** 品牌 Logo 方块里的短字（`brand` 角色）。 */
  logoText?: string
  /** 品牌副标题 / 用户区部门（`brand` / `user` 角色）。 */
  subtitle?: string
  /** 在线写的模板片段（vibeelement）；有它就用模板渲染该条目。 */
  code?: string
  /** 点击事件：声明式动作，运行期由外壳统一执行。 */
  action?: ShellAction
  /** 数据/事件绑定（与模板一起下发）。 */
  bindings?: ShellBinding[]
}

/** 编译产物：可直接入库、下发给外壳的外壳 schema。 */
export interface ShellSchema {
  key: string
  title: string
  description?: string
  frame: {
    sidebarWidth: number
    sidebarCollapsedWidth: number
    sidebarCollapsed: boolean
    sidebarBg?: string
    sidebarText?: string
    accent?: string
    topbarHeight: number
  }
  sidebar: {
    visible: boolean
    /** 品牌块（`brand` 角色）。 */
    brand?: ShellItem
    /** 菜单树（`menu` 角色）；缺省由内核菜单贡献装配。 */
    menu?: ShellItem
    /** 菜单搜索（`menu-search` 角色）。 */
    search?: ShellItem
    /** 收起按钮（`collapse` 角色）。 */
    collapse?: ShellItem
    /** 侧栏私有条目（品牌之外的自定义 icon 等）。 */
    items: ShellItem[]
  }
  topbar: {
    visible: boolean
    /** 靠左条目（面包屑/标题/工具）。 */
    left: ShellItem[]
    /** 靠右条目（图标行、用户区）。 */
    right: ShellItem[]
  }
  content: {
    /** 是否全出血（去内边距）。 */
    fullBleed: boolean
    /** 页签条（`tabs` 角色）。 */
    tabs?: ShellItem
  }
}

/** 装配分析：编译器「看懂」了外壳图纸什么，回显给设计器。 */
export interface ShellAnalysis {
  regions: Array<{ id: string; role: ShellRole; rect: UiRect; childIds: string[] }>
  title: string
  /** 顶栏图标行：id → 图标名与动作，供设计器画布与文案核对。 */
  icons: Array<{ id: string; icon?: string; label?: string; action?: ShellAction }>
  /** 在线写模板的元素 id。 */
  vibes: string[]
  unsupported: Array<{ elementId: string; role: ShellRole; reason: string }>
}

export interface ShellCompiled {
  key: string
  schema: ShellSchema
  diagnostics: UiDiagnostic[]
  questions: UiQuestion[]
  analysis: ShellAnalysis
}

/** 角色定义：语义 + 默认尺寸/文案/属性 + 可配属性白名单 + 着色。 */
export interface ShellRoleSpec {
  role: ShellRole
  label: string
  layer: 'region' | 'element' | 'band'
  defaultWidth: number
  defaultHeight: number
  defaultText: string
  props: ShellElementProps
  editable: ReadonlyArray<keyof ShellElementProps>
  tint: string
  description: string
}

const ICON_EDITABLE: ReadonlyArray<keyof ShellElementProps> = [
  'label', 'icon', 'tooltip', 'permission', 'variant', 'showLabel', 'badge', 'code',
]

export const SHELL_ROLE_SPECS: Record<ShellRole, ShellRoleSpec> = {
  shell: {
    role: 'shell', label: '整机外壳', layer: 'region', defaultWidth: 1440, defaultHeight: 900,
    defaultText: '', props: {}, editable: [], tint: '#e2e8f0', description: '最外层：承载侧栏、顶栏与内容区。',
  },
  sidebar: {
    role: 'sidebar', label: '侧栏', layer: 'region', defaultWidth: 248, defaultHeight: 900,
    defaultText: '', props: { width: 248, collapsedWidth: 76 }, editable: ['width', 'collapsedWidth', 'collapsed', 'bg', 'textColor', 'accent'],
    tint: '#dbeafe', description: '左侧栏区域：品牌、菜单、搜索、收起按钮都在里面。',
  },
  topbar: {
    role: 'topbar', label: '顶栏', layer: 'region', defaultWidth: 1192, defaultHeight: 76,
    defaultText: '', props: { height: 76 }, editable: ['height', 'accent'],
    tint: '#ede9fe', description: '顶部条区域：面包屑、图标行、用户区都在里面。',
  },
  content: {
    role: 'content', label: '内容区', layer: 'region', defaultWidth: 1192, defaultHeight: 824,
    defaultText: '', props: {}, editable: ['fullBleed'], tint: '#e0f2fe', description: '路由页面渲染区。',
  },
  brand: {
    role: 'brand', label: '品牌', layer: 'element', defaultWidth: 248, defaultHeight: 76,
    defaultText: 'Micro Admin',
    props: { logoText: 'MK', brandTitle: 'Micro Admin', brandSubtitle: '微内核控制台' },
    editable: ['logoText', 'brandTitle', 'brandSubtitle', 'icon', 'accent'], tint: '#bfdbfe',
    description: 'Logo 方块 + 主/副标题。',
  },
  menu: {
    role: 'menu', label: '菜单', layer: 'element', defaultWidth: 248, defaultHeight: 620,
    defaultText: '', props: {}, editable: ['label'], tint: '#c7d2fe',
    description: '导航菜单：由内核菜单贡献装配，可配分组顺序与标题。',
  },
  'menu-search': {
    role: 'menu-search', label: '菜单搜索', layer: 'element', defaultWidth: 224, defaultHeight: 32,
    defaultText: '', props: { icon: 'Search' }, editable: ['icon', 'label', 'code'], tint: '#a5b4fc',
    description: '菜单关键字过滤输入框。',
  },
  collapse: {
    role: 'collapse', label: '收起按钮', layer: 'element', defaultWidth: 224, defaultHeight: 38,
    defaultText: '', props: { icon: 'ArrowLeftBold' }, editable: [...ICON_EDITABLE], tint: '#cbd5e1',
    description: '侧栏底部收起/展开按钮。',
  },
  breadcrumb: {
    role: 'breadcrumb', label: '面包屑', layer: 'element', defaultWidth: 300, defaultHeight: 24,
    defaultText: '', props: { showLabel: true }, editable: ['label', 'showLabel', 'code'], tint: '#ddd6fe',
    description: '当前页标题：`控制台 / 页面名`。',
  },
  icon: {
    role: 'icon', label: '图标按钮', layer: 'element', defaultWidth: 34, defaultHeight: 34,
    defaultText: '图标', props: { icon: 'Bell', showLabel: false }, editable: ICON_EDITABLE, tint: '#f5d0fe',
    description: '顶栏图标：点击动作与模板都可配，是全站图标行的一等元素。',
  },
  user: {
    role: 'user', label: '用户区', layer: 'element', defaultWidth: 150, defaultHeight: 42,
    defaultText: '', props: { showLabel: true }, editable: ['label', 'showLabel', 'icon', 'code'], tint: '#fae8ff',
    description: '头像 + 用户名 + 下拉（个人中心 / 插件中心 / 退出）。',
  },
  tabs: {
    role: 'tabs', label: '页签条', layer: 'element', defaultWidth: 900, defaultHeight: 32,
    defaultText: '', props: {}, editable: ['label'], tint: '#f0abfc',
    description: '已打开页面的标签条（可选）。',
  },
  text: {
    role: 'text', label: '文本', layer: 'band', defaultWidth: 120, defaultHeight: 24,
    defaultText: '文字', props: {}, editable: ['label', 'code', 'icon'], tint: '#f8fafc',
    description: '纯文案：自定义标题、说明。',
  },
  divider: {
    role: 'divider', label: '分隔线', layer: 'band', defaultWidth: 1, defaultHeight: 24,
    defaultText: '', props: {}, editable: [], tint: '#e2e8f0', description: '竖向分隔线。',
  },
}

export const SHELL_ROLE_LIST: ShellRoleSpec[] = Object.values(SHELL_ROLE_SPECS)

/** 按角色取定义；未知角色退回文本，保证旧图纸不炸。 */
export function shellSpecOf(role: ShellRole): ShellRoleSpec {
  return SHELL_ROLE_SPECS[role] ?? SHELL_ROLE_SPECS.text
}

/** 合并元素自身属性与角色默认值：元素 > 角色。 */
export function shellEffectiveProps(element: ShellElement): ShellElementProps {
  return { ...shellSpecOf(element.role).props, ...element.props }
}

/** 该属性是否允许配置（属性面板据此过滤）。 */
export function shellCanConfigure(role: ShellRole, key: string): boolean {
  return shellSpecOf(role).editable.includes(key as keyof ShellElementProps)
}

/** 外壳事件通道表：只有点击（外壳元素本质是按钮/入口）。 */
export const SHELL_CHANNELS: ReadonlyArray<string> = ['click']

/** 空白外壳图纸：新建时的唯一初始值（含当前外壳的默认结构）。 */
export function createEmptyShellDrawing(key = 'shell.default', title = '默认外壳'): ShellDrawing {
  return {
    version: 1,
    meta: { key, title, description: '由图纸编译：改图纸即改外壳，不需要发版。' },
    canvas: { width: 1440, height: 900, grid: 20, background: '#f8fafc', showGrid: true },
    elements: [
      shellElement('shell', 'shell', { x: 0, y: 0, width: 1440, height: 900 }, { zIndex: 0 }),
      shellElement('sidebar', 'sidebar', { x: 0, y: 0, width: 248, height: 900 }, { zIndex: 1 }),
      shellElement('topbar', 'topbar', { x: 248, y: 0, width: 1192, height: 76 }, { zIndex: 1 }),
      shellElement('content', 'content', { x: 248, y: 76, width: 1192, height: 824 }, { zIndex: 1 }),
      shellElement('brand', 'brand', { x: 0, y: 0, width: 248, height: 76 }, { zIndex: 2 }),
      shellElement('menu', 'menu', { x: 0, y: 90, width: 248, height: 620 }, { zIndex: 2 }),
      shellElement('menu-search', 'menu-search', { x: 12, y: 78, width: 224, height: 32 }, { zIndex: 3 }),
      shellElement('collapse', 'collapse', { x: 12, y: 850, width: 224, height: 38 }, { zIndex: 2 }),
      shellElement('breadcrumb', 'breadcrumb', { x: 288, y: 26, width: 300, height: 24 }, { zIndex: 2 }),
      shellElement('icon-theme', 'icon', { x: 1180, y: 21, width: 34, height: 34 }, {
        zIndex: 2, text: '切换主题',
        props: { icon: 'Moon', tooltip: '切换深浅色', showLabel: false },
        bindings: [{ kind: 'event', channel: 'click', action: 'emit', params: { event: 'shell.toggle-theme' } }],
      }),
      shellElement('icon-notice', 'icon', { x: 1222, y: 21, width: 34, height: 34 }, {
        zIndex: 2, text: '通知公告',
        props: { icon: 'Bell', tooltip: '通知公告', badge: 'dot' },
        bindings: [{ kind: 'event', channel: 'click', action: 'navigate', params: { path: '/system/notice' } }],
      }),
      shellElement('user', 'user', { x: 1266, y: 17, width: 160, height: 42 }, { zIndex: 2 }),
    ],
  }
}

/** 元素构造快捷函数（与 ui-canvas 的 element 同形，供种子与新建使用）。 */
export function shellElement(
  id: string,
  role: ShellRole,
  rect: UiRect,
  patch: Partial<ShellElement> = {},
): ShellElement {
  return {
    id,
    role,
    rect,
    zIndex: patch.zIndex ?? 0,
    text: patch.text ?? shellSpecOf(role).defaultText,
    props: patch.props ?? {},
    bindings: patch.bindings ?? [],
    locked: patch.locked ?? false,
    visible: patch.visible ?? true,
  }
}

function shellSpec(role: ShellRole): ShellRoleSpec {
  return SHELL_ROLE_SPECS[role] ?? SHELL_ROLE_SPECS.text
}

function regionOfPoint(drawing: ShellDrawing, element: ShellElement): ShellRole | null {
  const containers: ShellRole[] = ['sidebar', 'topbar', 'content']
  const point = centerOf(element.rect)
  // 小的优先：元素落在「最小的包含它的区域」里。
  const sorted = containers
    .map((role) => drawing.elements.find((item) => item.role === role && item.visible !== false))
    .filter((item): item is ShellElement => Boolean(item))
    .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height)
  for (const container of sorted) {
    if (containsPoint(container.rect, point)) return container.role
  }
  return null
}

/** 把外壳元素编译成一条 `ShellItem`（画布预览与运行期共用，不出现第二份映射）。 */
export function shellItemOf(element: ShellElement): ShellItem {
  const props = shellEffectiveProps(element)
  const binding = element.bindings.find((entry) => entry.kind === 'event' && entry.channel === 'click')
  const action = binding && binding.action && binding.action !== 'none'
    ? {
        kind: binding.action,
        ...(binding.params ? { params: binding.params } : {}),
        ...(binding.confirm ? { confirm: binding.confirm } : {}),
      }
    : undefined
  const code = String(props.code ?? '').trim()
  const item: ShellItem = { id: element.id, role: element.role }
  // 品牌的主标题既可能写在 `label` 也可能写在 `brandTitle`（角色专有属性），两者都认。
  const label = props.label ?? props.brandTitle ?? element.text
  if (label) item.label = String(label)
  if (props.icon) item.icon = props.icon
  if (props.tooltip ?? props.label) item.tooltip = String(props.tooltip ?? props.label)
  if (props.permission) item.permission = props.permission
  if (props.variant && props.variant !== 'default') item.variant = props.variant
  if (props.showLabel !== undefined) item.showLabel = props.showLabel
  if (props.badge) item.badge = props.badge
  if (props.logoText) item.logoText = String(props.logoText)
  const subtitle = props.brandSubtitle
  if (subtitle) item.subtitle = String(subtitle)
  if (code) item.code = code
  if (action) item.action = action
  if (element.bindings.length) {
    item.bindings = element.bindings.map((entry) => ({
      channel: entry.channel,
      kind: entry.kind,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.action ? { action: entry.action } : {}),
      ...(entry.params ? { params: entry.params } : {}),
    }))
  }
  return item
}

/** 校验外壳元素的点击绑定：动作必须完整，否则点了没反应。 */
function validateShellBindings(element: ShellElement, push: (level: UiDiagnostic['level'], code: string, message: string) => void): void {
  for (const binding of element.bindings) {
    if (binding.kind !== 'event') continue
    if (!binding.action || binding.action === 'none') {
      push('warn', 'shell-click-no-action', `图标「${element.text || element.id}」的点击没有动作，点了不会有反应`)
      continue
    }
    const params = binding.params ?? {}
    if (binding.action === 'navigate' && !params.path) {
      push('error', 'shell-navigate-no-path', `图标「${element.text || element.id}」的动作是跳转，但没给目标路径`)
    }
    if (binding.action === 'request' && !params.path) {
      push('error', 'shell-request-no-path', `图标「${element.text || element.id}」的动作是请求，但没给接口路径`)
    }
    if (binding.action === 'command' && !params.name) {
      push('error', 'shell-command-no-name', `图标「${element.text || element.id}」的动作是命令，但没给命令名`)
    }
    if (binding.action === 'emit' && !params.event) {
      push('error', 'shell-emit-no-event', `图标「${element.text || element.id}」的动作是派发，但没给事件名`)
    }
  }
}

/**
 * 外壳图纸 → 外壳 schema。
 *
 * 不猜语义：能编译的编译，看不懂的落成诊断。顶栏条目按「几何横向位置 + align 属性」
 * 分成左右两排，因此拖动图标就能改变它在顶栏的位置——这就是画布即外壳。
 */
export function compileShellDrawing(drawing: ShellDrawing): ShellCompiled {
  const diagnostics: UiDiagnostic[] = []
  const questions: UiQuestion[] = []
  const push = (level: UiDiagnostic['level'], code: string, message: string, elementId?: string): void => {
    diagnostics.push({ level, code, message, ...(elementId ? { elementId } : {}) })
  }

  const visible = drawing.elements.filter((element) => element.visible !== false)
  const find = (role: ShellRole): ShellElement | undefined => visible.find((element) => element.role === role)
  const region = (role: ShellRole): ShellElement | undefined => find(role)

  const sidebarEl = region('sidebar')
  const topbarEl = region('topbar')
  const sidebarProps = sidebarEl ? shellEffectiveProps(sidebarEl) : {}
  const topbarProps = topbarEl ? shellEffectiveProps(topbarEl) : {}
  const contentEl = find('content')
  const contentProps = contentEl ? shellEffectiveProps(contentEl) : {}

  // 顶栏元素：非区域、中心落在 topbar 里的元素。
  const topbarRect = topbarEl?.rect ?? { x: 0, y: 0, width: 0, height: 0 }
  const topbarChildren = visible.filter(
    (element) => shellSpec(element.role).layer !== 'region'
      && regionOfPoint(drawing, element) === 'topbar',
  ).sort((left, right) => left.rect.x - right.rect.x)

  const sidebarChildren = visible.filter(
    (element) => shellSpec(element.role).layer !== 'region'
      && regionOfPoint(drawing, element) === 'sidebar',
  )

  const icons: ShellAnalysis['icons'] = []
  const vibes: string[] = []

  const left: ShellItem[] = []
  const right: ShellItem[] = []
  const midX = topbarRect.x + topbarRect.width / 2
  for (const element of topbarChildren) {
    const props = shellEffectiveProps(element)
    if (props.code) vibes.push(element.id)
    validateShellBindings(element, (level, code, message) => push(level, code, message, element.id))
    const item = shellItemOf(element)
    if (element.role === 'icon') icons.push({ id: element.id, ...(item.icon ? { icon: item.icon } : {}), ...(item.label ? { label: item.label } : {}), ...(item.action ? { action: item.action } : {}) })
    const align = props.align ?? (element.rect.x + element.rect.width / 2 >= midX ? 'right' : 'left')
    if (align === 'right') right.push(item)
    else left.push(item)
  }

  // 侧栏：品牌 / 搜索 / 收起各占一个专属槽位，其余自定义条目按纵向顺序进 items。
  let brand: ShellItem | undefined
  let menu: ShellItem | undefined
  let search: ShellItem | undefined
  let collapse: ShellItem | undefined
  const sidebarItems: ShellItem[] = []
  for (const element of [...sidebarChildren].sort((l, r) => l.rect.y - r.rect.y)) {
    const props = shellEffectiveProps(element)
    if (props.code) vibes.push(element.id)
    validateShellBindings(element, (level, code, message) => push(level, code, message, element.id))
    const item = shellItemOf(element)
    if (element.role === 'brand') brand = item
    else if (element.role === 'menu') menu = item
    else if (element.role === 'menu-search') search = item
    else if (element.role === 'collapse') collapse = item
    else sidebarItems.push(item)
  }

  // 页签条：顶栏/内容区里的 tabs 元素（不强制）。
  const tabsEl = visible.find((element) => element.role === 'tabs')

  // 品牌/侧栏宽度缺省：优先元素声明，否则取区域几何，最后走内置。
  const sidebarWidth = sidebarProps.width ?? (sidebarEl ? Math.round(sidebarEl.rect.width) : 248)
  const sidebarCollapsedWidth = sidebarProps.collapsedWidth ?? 76
  const topbarHeight = topbarProps.height ?? (topbarEl ? Math.round(topbarEl.rect.height) : 76)

  // 「重构过的元素」不能凭空消失：既不是区域、也没落进任何区域的可见元素落成诊断。
  const unsupported: ShellAnalysis['unsupported'] = []
  for (const element of visible) {
    if (shellSpec(element.role).layer === 'region') continue
    if (regionOfPoint(drawing, element)) continue
    unsupported.push({ elementId: element.id, role: element.role, reason: `元素「${element.text || element.id}」不在侧栏/顶栏/内容区里，运行期不会渲染` })
    push('warn', 'shell-element-outside-region', `元素「${element.text || element.id}」不在任何区域内，运行期不会渲染`, element.id)
  }

  const schema: ShellSchema = {
    key: drawing.meta.key,
    title: drawing.meta.title,
    ...(drawing.meta.description ? { description: drawing.meta.description } : {}),
    frame: {
      sidebarWidth,
      sidebarCollapsedWidth,
      sidebarCollapsed: sidebarProps.collapsed === true,
      ...(sidebarProps.bg ? { sidebarBg: sidebarProps.bg } : {}),
      ...(sidebarProps.textColor ? { sidebarText: sidebarProps.textColor } : {}),
      ...(sidebarProps.accent || topbarProps.accent ? { accent: sidebarProps.accent ?? topbarProps.accent } : {}),
      topbarHeight,
    },
    sidebar: {
      visible: sidebarEl?.visible !== false,
      ...(brand ? { brand } : {}),
      ...(menu ? { menu } : {}),
      ...(search ? { search } : {}),
      ...(collapse ? { collapse } : {}),
      items: sidebarItems,
    },
    topbar: {
      visible: topbarEl?.visible !== false,
      left,
      right,
    },
    content: {
      fullBleed: contentProps.fullBleed === true,
      ...(tabsEl ? { tabs: shellItemOf(tabsEl) } : {}),
    },
  }

  const regions = (['sidebar', 'topbar', 'content'] as ShellRole[])
    .map((role) => visible.find((element) => element.role === role))
    .filter((element): element is ShellElement => Boolean(element))
    .map((element) => ({
      id: element.id,
      role: element.role,
      rect: element.rect,
      childIds: visible
        .filter((child) => shellSpec(child.role).layer !== 'region' && regionOfPoint(drawing, child) === element.role)
        .map((child) => child.id),
    }))

  const analysis: ShellAnalysis = {
    regions,
    title: drawing.meta.title,
    icons,
    vibes,
    unsupported,
  }

  return { key: drawing.meta.key, schema, diagnostics, questions, analysis }
}

/** 外壳元素的默认在线模板：给新图标/新用户区一个能跑的起点，而不是空白框。 */
export function defaultShellCodeOf(element: ShellElement): string {
  const label = String(shellEffectiveProps(element).label ?? element.text ?? shellSpecOf(element.role).label)
  switch (element.role) {
    case 'icon':
      return `<el-tooltip content="${label}" placement="bottom"><el-button circle text @click="onClick"><el-icon :size="17"><component :is="'${String(shellEffectiveProps(element).icon ?? 'Bell')}'" /></el-icon></el-button></el-tooltip>`
    case 'user':
      return `<button class="shell-user" type="button" @click="onClick"><span class="shell-user__avatar">{{ user.slice(0, 1) }}</span><span class="shell-user__meta"><strong>{{ user }}</strong></span></button>`
    case 'brand':
      return `<div class="shell-brand"><span class="shell-brand__logo">${String(shellEffectiveProps(element).logoText ?? 'MK')}</span><span class="shell-brand__text"><strong>{{ label }}</strong></span></div>`
    case 'menu-search':
      return `<el-input size="small" placeholder="${label || '搜索'}" @update:model-value="onClick" />`
    case 'text':
      return `<span class="shell-text">{{ text }}</span>`
    case 'breadcrumb':
      return `<div class="shell-breadcrumb"><span>控制台</span><i>/</i><strong>{{ title }}</strong></div>`
    default:
      return `<div class="shell-${element.role}">{{ label }}</div>`
  }
}

/** 元素 → 下发用的 vibe 片段（与页面元素同一份安全检查）。 */
export function shellVibeOf(element: ShellElement): VibeSchema | null {
  const code = String(shellEffectiveProps(element).code ?? '').trim()
  if (!code) return null
  // 模板渲染器只需「有哪些通道」来决定方法名（onClick…）；动作本身由外壳执行，
  // 因此这里只下发通道/方向/取值键，不带 shell 专有动作，避免与 VibeBindingSchema 的动作集打架。
  const bindings: VibeBindingSchema[] = []
  for (const binding of element.bindings) {
    bindings.push({
      channel: binding.channel,
      kind: binding.kind,
      ...(binding.source ? { source: binding.source } : {}),
    })
  }
  return bindings.length ? { code, bindings } : { code }
}

/** 解析外壳图纸 JSON：字段缺失按默认值补齐，老图纸不炸设计器。 */
export function parseShellDrawing(raw: string | null | undefined, fallbackKey = 'shell.default'): ShellDrawing {
  const empty = createEmptyShellDrawing(fallbackKey)
  if (!raw || !raw.trim()) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object') return empty
  const record = parsed as Partial<ShellDrawing>
  return {
    version: Number(record.version ?? 1) || 1,
    meta: { ...empty.meta, ...(record.meta ?? {}) },
    canvas: { ...empty.canvas, ...(record.canvas ?? {}) },
    elements: Array.isArray(record.elements)
      ? record.elements.map((element, index) => normalizeShellElement(element, index))
      : [],
  }
}

function normalizeShellElement(raw: unknown, index: number): ShellElement {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rect = (record.rect && typeof record.rect === 'object' ? record.rect : {}) as Record<string, unknown>
  return {
    id: String(record.id ?? `sh-${index + 1}`),
    role: (typeof record.role === 'string' ? record.role : 'text') as ShellRole,
    rect: {
      x: Number(rect.x ?? 0) || 0,
      y: Number(rect.y ?? 0) || 0,
      width: Number(rect.width ?? 120) || 120,
      height: Number(rect.height ?? 32) || 32,
    },
    zIndex: Number(record.zIndex ?? index) || 0,
    text: String(record.text ?? ''),
    props: (record.props && typeof record.props === 'object' ? record.props : {}) as ShellElementProps,
    bindings: Array.isArray(record.bindings) ? (record.bindings as ShellBinding[]) : [],
    locked: Boolean(record.locked),
    visible: record.visible !== false,
  }
}
