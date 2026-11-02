import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

/** 菜单是插件的声明式导航能力。位置不靠数字猜，而由分组与排序字段共同决定。 */
export interface ContributionOwner {
  /** 内核自动写入，用于停用插件时同步剔除其导航与页面。 */
  pluginId?: string
}

export interface MenuContribution extends ContributionOwner {
  id: string
  title: string
  /** 叶子页面的路径；目录节点（`folder` 或有子项）可不填。 */
  path?: string
  icon?: string
  /** 一级分组标题；分组是自动生成的目录，插件不注册分组本身。 */
  group?: string
  /**
   * 父菜单 id：有值时挂到该节点下，层级不限。
   *
   * 与 `group` 二选一即可——`parent` 优先，因此插件可以自建「目录 → 子目录 → 页面」
   * 的任意深度结构，而不必等别人先注册分组。
   */
  parent?: string
  /** 显式目录：只有子项、自身不可点。有子项时即使不写也会自动变成目录。 */
  folder?: boolean
  order?: number
  permission?: string
  hidden?: boolean
  badge?: string
}

/** 页面注册不直接改 router，统一通过内核编译成路由表。 */
export interface RouteContribution extends ContributionOwner {
  name: string
  path: string
  /** 页面组件；纯跳转路由用 `redirect` 代替。 */
  component?: () => Promise<Component | { default: Component }>
  /**
   * 旧地址兼容：合并页面后把老路由指向新地址，避免收藏/标签页失效。
   *
   * 函数形式可以带上原查询串（例如 `/scada/preview?screenId=1` → `/canvas?tab=preview&screenId=1`），
   * 否则「带参数的深链接」一跳转就丢上下文。
   */
  redirect?: RouteRecordRaw['redirect']
  title?: string
  permission?: string
  meta?: Record<string, unknown>
}

/** 页面内的具名扩展点，供其他插件注入卡片、工具条或提示。 */
export interface SlotContribution extends ContributionOwner {
  name: string
  id: string
  component: Component
  order?: number
  permission?: string
  /**
   * 槽位自带标题/图标：供「页签型槽位」（例如 `canvas:tab`）渲染成一条页签。
   *
   * 普通槽位（`scada:assistant` 之类）不写，槽位宿主也不关心这两个字段；
   * 外壳的顶栏图标不用槽位——它由 `ShellSchema` 渲染（见 `packages/ui-canvas` 的 `shell`）；
   * 它们是声明的一部分，而不是让外壳再维护一张「谁在哪个槽位里叫什么」的对照表。
   */
  title?: string
  icon?: string
}

export interface WidgetContribution extends ContributionOwner {
  id: string
  title: string
  component: Component
  span?: 1 | 2 | 3 | 4
  order?: number
  permission?: string
}

export type MaybePromise<T> = T | Promise<T>

/**
 * 设置值：插件自己的设置对象，键支持 `panel.width` 这种点路径。
 *
 * 值由插件定义、由后端持有；内核只负责按声明渲染，不解释业务字段。
 */
export type SettingValues = Record<string, unknown>

/** 设置项控件类型：系统设置页只认这些，插件不再各写一套表单。 */
export type SettingFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'switch'
  | 'select'
  | 'color'
  | 'secret'
  | 'tags'
  | 'records'
  | 'json'

export interface SettingOption {
  value: string | number
  label: string
  hint?: string
}

/**
 * 一个设置字段。
 *
 * `required` 与 `pattern` 同时驱动「标签星号」和提交校验——两者同源，
 * 不允许只在提交后弹错误文案。需要按当前值决定时（例如已存过密钥就不再必填）
 * 传函数即可。
 */
export interface SettingField {
  /** 支持 `panel.width` 点路径。 */
  key: string
  label: string
  type: SettingFieldType
  /** 字段说明；函数形式可引用当前值（例如密钥末四位提示）。 */
  hint?: string | ((values: SettingValues) => string)
  placeholder?: string | ((values: SettingValues) => string)
  required?: boolean | ((values: SettingValues) => boolean)
  /** 正则源码字符串，渲染器自行编译。 */
  pattern?: string
  patternMessage?: string
  min?: number
  max?: number
  step?: number
  precision?: number
  rows?: number
  options?: SettingOption[]
  /** `records` 的列定义（列只用于行内编辑，不参与顶层校验）。 */
  columns?: SettingField[]
  /** 独占整行；默认两列栅格。 */
  full?: boolean
  mono?: boolean
  disabled?: boolean | ((values: SettingValues) => boolean)
  visible?: (values: SettingValues) => boolean
  /** 所属卡片（`SettingBlock.id`）；不写归入默认卡片。 */
  block?: string
}

/** 设置卡片：同一分区内的字段按块渲染，避免一个页面堆成一张巨型表单。 */
export interface SettingBlock {
  id: string
  title: string
  description?: string
}

/** 设置区的附加动作：自检、试跑、清空密钥等只有一个入口的操作。 */
export interface SettingAction {
  id: string
  label: string
  icon?: string
  kind?: 'default' | 'primary' | 'danger'
  visible?: (values: SettingValues) => boolean
  disabled?: (values: SettingValues, context: { dirty: boolean }) => boolean
  /** 返回字符串作为成功提示；抛错由页面统一显示。 */
  run: (values: SettingValues) => MaybePromise<string | void>
  /** 动作改动了服务端状态时，执行后重新读取（例如清空密钥）。 */
  reloadAfter?: boolean
}

/**
 * 设置贡献：插件把自己的设置交给系统设置页渲染。
 *
 * 两种形态：
 * - 声明式：给 `fields` + `load/save`，控件、校验、脏检查、保存按钮都由内核渲染；
 * - 自定义：给 `component`，整块自渲染自保存（需要实时预览这类交互时用）。
 *
 * `group` 决定系统设置页的一个标签页：同一分组的插件贡献自动并到同一个 tab。
 */
export interface SettingSectionContribution extends ContributionOwner {
  id: string
  group: SettingGroup
  title: string
  description?: string
  order?: number
  /** 可见性与保存都按它收窄；不写 = 登录即可见。 */
  permission?: string
  blocks?: SettingBlock[]
  fields?: SettingField[]
  component?: Component
  load?: () => MaybePromise<SettingValues>
  save?: (values: SettingValues) => MaybePromise<string | void>
  /** 恢复默认值：只填表单，不自动保存。 */
  defaults?: () => MaybePromise<SettingValues>
  actions?: SettingAction[]
  /** 值变化时的即时回调（例如主题预览）；不会写后端。 */
  onChange?: (values: SettingValues) => void
}

export interface SettingGroup {
  id: string
  title: string
  order?: number
  icon?: string
}

/**
 * 插件上下文是唯一能力入口。
 * 插件不 import 宿主内部模块，也不持有全局单例，便于按需启停和测试。
 */
export interface PluginContext {
  readonly id: string
  readonly config: Readonly<Record<string, unknown>>
  readonly logger: PluginLogger
  readonly services: ServiceRegistry
  readonly routes: ContributionRegistry<RouteContribution>
  readonly menus: ContributionRegistry<MenuContribution>
  readonly slots: ContributionRegistry<SlotContribution>
  readonly widgets: ContributionRegistry<WidgetContribution>
  /** 把本插件的设置交给系统设置页（标签页由分组决定）。 */
  readonly settings: ContributionRegistry<SettingSectionContribution>
  readonly configs: ConfigRegistry
  readonly http: HttpRegistry
  readonly events: EventBus
  readonly commands: CommandRegistry
}

export interface PluginLogger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

/** 插件是纯声明对象，宿主负责生命周期，不要求插件知道 Vue 应用何时挂载。 */
export interface PluginDefinition {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  requires?: string[]
  optionalRequires?: string[]
  defaultEnabled?: boolean
  setup(context: PluginContext): MaybePromise<void | PluginTeardown>
}

export type PluginTeardown = () => MaybePromise<void>

export interface PluginStatus {
  id: string
  name: string
  version: string
  description: string
  author: string
  requires: string[]
  optionalRequires: string[]
  defaultEnabled: boolean
  enabled: boolean
  state: 'registered' | 'enabled' | 'disabled' | 'failed'
  error?: string
  order: number
}

export interface ServiceRegistry {
  register<T>(token: string, service: T): () => void
  get<T>(token: string): T | undefined
  require<T>(token: string): T
  has(token: string): boolean
  list(): string[]
}

export interface ConfigRegistry {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

/** HTTP 抽象让 Mock 与真实后端使用同一调用路径，业务插件不直接读环境变量。 */
export interface HttpRegistry {
  request<T>(path: string, init?: RequestInit): Promise<T>
}

export interface ContributionRegistry<T extends { id?: string; name?: string }> {
  add(item: T): () => void
  remove(item: T): void
  all(): T[]
}

export interface EventBus {
  on<T = unknown>(event: string, handler: (payload: T) => void): () => void
  emit<T = unknown>(event: string, payload: T): void
}

export interface CommandRegistry {
  register(name: string, handler: (...args: unknown[]) => MaybePromise<unknown>): () => void
  execute<T = unknown>(name: string, ...args: unknown[]): Promise<T>
  list(): string[]
}

export interface KernelOptions {
  plugins: PluginDefinition[]
  enabled?: Record<string, boolean>
  pluginConfig?: Record<string, Record<string, unknown>>
  onError?: (pluginId: string, error: unknown) => void
}

/** 路由表交给业务层消费；内核本身不依赖 router 实例。 */
export interface CompiledRoutes {
  routes: RouteRecordRaw[]
  menus: MenuContribution[]
}
