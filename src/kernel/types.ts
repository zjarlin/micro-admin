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
  path: string
  icon?: string
  group?: string
  order?: number
  permission?: string
  hidden?: boolean
  badge?: string
}

/** 页面注册不直接改 router，统一通过内核编译成路由表。 */
export interface RouteContribution extends ContributionOwner {
  name: string
  path: string
  component: () => Promise<Component | { default: Component }>
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
