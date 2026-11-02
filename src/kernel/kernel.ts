import {
  createContributionRegistry,
  createEventBus,
  createLogger,
  createServiceRegistry,
} from './registry'
import type {
  CommandRegistry,
  KernelOptions,
  MaybePromise,
  PluginContext,
  PluginDefinition,
  PluginStatus,
  PluginTeardown,
  RouteContribution,
  MenuContribution,
  SlotContribution,
  WidgetContribution,
  SettingSectionContribution,
} from './types'

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/

/** 宿主内核：只负责发现、校验、排序、启停和资源回收。 */
export class MicroKernel {
  private readonly definitions = new Map<string, PluginDefinition>()
  private readonly statuses = new Map<string, PluginStatus>()
  private readonly teardowns = new Map<string, PluginTeardown>()
  private readonly disposers = new Map<string, Array<() => void>>()
  private readonly contexts = new Map<string, PluginContext>()
  private readonly startOrder: string[] = []
  private readonly bootOrder: string[]
  private readonly options: KernelOptions
  private readonly services = createServiceRegistry()
  private readonly routes = createContributionRegistry<RouteContribution>('route')
  private readonly menus = createContributionRegistry<MenuContribution>('menu')
  private readonly slots = createContributionRegistry<SlotContribution>('slot')
  private readonly widgets = createContributionRegistry<WidgetContribution>('widget')
  private readonly settings = createContributionRegistry<SettingSectionContribution>('setting')
  private readonly events = createEventBus()
  private readonly commands: CommandRegistry = this.createCommands()

  constructor(options: KernelOptions) {
    this.options = options
    this.registerAll(options.plugins)
    this.bootOrder = this.resolveOrder()
  }

  /** 返回稳定排序后的启动序列，仅启用的插件会按依赖顺序出现。 */
  get order(): string[] {
    return [...this.bootOrder]
  }

  list(): PluginStatus[] {
    return [...this.statuses.values()].sort((a, b) => a.order - b.order)
  }

  routeContributions(): RouteContribution[] {
    return this.routes.all()
  }

  menuContributions(): MenuContribution[] {
    return this.menus
      .all()
      .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || (a.order ?? 100) - (b.order ?? 100))
  }

  widgetContributions(): WidgetContribution[] {
    return this.widgets.all().sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  /** 设置贡献按分组顺序 + 区内顺序返回；渲染时再按权限与插件状态过滤。 */
  settingContributions(): SettingSectionContribution[] {
    return this.settings.all().sort(
      (a, b) => (a.group.order ?? 100) - (b.group.order ?? 100) || (a.order ?? 100) - (b.order ?? 100),
    )
  }

  slotContributions(name: string): SlotContribution[] {
    return this.slots
      .all()
      .filter((slot) => slot.name === name)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  serviceTokens(): string[] {
    return this.services.list()
  }

  getStatus(id: string): PluginStatus | undefined {
    return this.statuses.get(id)
  }

  async start(): Promise<void> {
    for (const id of this.bootOrder) {
      if (!this.isEnabled(id)) continue
      await this.enable(id)
    }
  }

  async enable(id: string): Promise<void> {
    const status = this.statuses.get(id)
    if (!status) throw new Error(`unknown plugin: ${id}`)
    if (status.enabled) return

    const definition = this.definitions.get(id)
    if (!definition) throw new Error(`unknown plugin: ${id}`)

    for (const dependency of definition.requires ?? []) {
      const dependencyStatus = this.statuses.get(dependency)
      if (!dependencyStatus?.enabled) {
        throw new Error(`plugin ${id} requires enabled plugin ${dependency}`)
      }
    }

    status.enabled = true
    try {
      const context = this.createContext(definition)
      this.contexts.set(id, context)
      const result = await definition.setup(context)
      if (typeof result === 'function') this.teardowns.set(id, result)
      status.state = 'enabled'
      delete status.error
      this.startOrder.push(id)
      this.events.emit('kernel:plugin-enabled', { id })
    } catch (error) {
      status.enabled = false
      status.state = 'failed'
      status.error = error instanceof Error ? error.message : String(error)
      this.rollback(id)
      this.options.onError?.(id, error)
      throw error
    }
  }

  async disable(id: string): Promise<void> {
    const status = this.statuses.get(id)
    if (!status || !status.enabled) return

    // 依赖此插件的仍在运行插件必须先停，否则会留下悬空消费者。
    const dependents = [...this.definitions.values()].filter(
      (plugin) => plugin.requires?.includes(id) && this.statuses.get(plugin.id)?.enabled,
    )
    for (const plugin of dependents) await this.disable(plugin.id)

    this.rollback(id)
    status.enabled = false
    status.state = 'disabled'
    this.events.emit('kernel:plugin-disabled', { id })
  }

  async stop(): Promise<void> {
    for (const id of [...this.startOrder].reverse()) await this.disable(id)
  }

  /** 宿主在启动插件前注入共享能力，避免插件直接依赖浏览器全局对象。 */
  provideService<T>(token: string, service: T): () => void {
    return this.services.register(token, service)
  }

  contextFor(id: string): PluginContext {
    const existing = this.contexts.get(id)
    if (existing) return existing
    const definition = this.definitions.get(id)
    if (!definition) throw new Error(`unknown plugin: ${id}`)
    const context = this.createContext(definition)
    this.contexts.set(id, context)
    return context
  }

  private registerAll(plugins: PluginDefinition[]): void {
    for (const plugin of plugins) this.register(plugin)
    for (const id of this.definitions.keys()) this.assertDependencies(id)
    this.assertAcyclic()
  }

  private register(plugin: PluginDefinition): void {
    if (!PLUGIN_ID.test(plugin.id)) throw new Error(`invalid plugin id: ${plugin.id}`)
    if (this.definitions.has(plugin.id)) throw new Error(`duplicate plugin id: ${plugin.id}`)
    this.definitions.set(plugin.id, plugin)
    this.statuses.set(plugin.id, {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description ?? '',
      author: plugin.author ?? 'core',
      requires: [...(plugin.requires ?? [])],
      optionalRequires: [...(plugin.optionalRequires ?? [])],
      defaultEnabled: plugin.defaultEnabled ?? true,
      enabled: false,
      state: 'registered',
      order: 0,
    })
  }

  private resolveOrder(): string[] {
    const visited = new Map<string, 'visiting' | 'visited'>()
    const result: string[] = []

    const visit = (id: string) => {
      const state = visited.get(id)
      if (state === 'visiting') throw new Error(`circular plugin dependency at ${id}`)
      if (state === 'visited') return
      visited.set(id, 'visiting')
      const plugin = this.definitions.get(id)
      if (!plugin) throw new Error(`unknown plugin dependency: ${id}`)
      for (const dependency of plugin.requires ?? []) visit(dependency)
      visited.set(id, 'visited')
      result.push(id)
    }

    for (const id of this.definitions.keys()) visit(id)
    result.forEach((id, index) => {
      const status = this.statuses.get(id)
      if (status) status.order = index + 1
    })
    return result
  }

  private assertDependencies(id: string): void {
    const plugin = this.definitions.get(id)
    if (!plugin) return
    for (const dependency of plugin.requires ?? []) {
      if (!this.definitions.has(dependency)) {
        throw new Error(`plugin ${id} requires missing plugin ${dependency}`)
      }
    }
  }

  private assertAcyclic(): void {
    const visiting = new Set<string>()
    const done = new Set<string>()
    const walk = (id: string) => {
      if (done.has(id)) return
      if (visiting.has(id)) throw new Error(`circular plugin dependency at ${id}`)
      visiting.add(id)
      for (const dependency of this.definitions.get(id)?.requires ?? []) walk(dependency)
      visiting.delete(id)
      done.add(id)
    }
    for (const id of this.definitions.keys()) walk(id)
  }

  private isEnabled(id: string): boolean {
    const override = this.options.enabled?.[id]
    return override ?? this.statuses.get(id)?.defaultEnabled ?? false
  }

  private createCommands(): CommandRegistry {
    const handlers = new Map<string, (...args: unknown[]) => MaybePromise<unknown>>()
    return {
      register: (name, handler) => {
        if (handlers.has(name)) throw new Error(`command already registered: ${name}`)
        handlers.set(name, handler)
        return () => {
          if (handlers.get(name) === handler) handlers.delete(name)
        }
      },
      execute: async <T>(name: string, ...args: unknown[]) => {
        const handler = handlers.get(name)
        if (!handler) throw new Error(`unknown command: ${name}`)
        return (await handler(...args)) as T
      },
      list: () => [...handlers.keys()].sort(),
    }
  }

  private createContext(definition: PluginDefinition): PluginContext {
    const id = definition.id
    const pluginConfig = this.options.pluginConfig?.[id] ?? {}
    const disposers: Array<() => void> = []
    const track = (dispose: () => void) => {
      disposers.push(dispose)
      return dispose
    }
    this.disposers.set(id, disposers)

    return {
      id,
      config: Object.freeze({ ...pluginConfig }),
      logger: createLogger(id),
      services: {
        register: (token, service) => track(this.services.register(token, service)),
        get: (token) => this.services.get(token),
        require: (token) => this.services.require(token),
        has: (token) => this.services.has(token),
        list: () => this.services.list(),
      },
      routes: {
        add: (route) => track(this.routes.add({ ...route, pluginId: id })),
        remove: (route) => this.routes.remove(route),
        all: () => this.routes.all(),
      },
      menus: {
        add: (menu) => track(this.menus.add({ ...menu, pluginId: id })),
        remove: (menu) => this.menus.remove(menu),
        all: () => this.menus.all(),
      },
      slots: {
        add: (slot) => track(this.slots.add({ ...slot, pluginId: id })),
        remove: (slot) => this.slots.remove(slot),
        all: () => this.slots.all(),
      },
      widgets: {
        add: (widget) => track(this.widgets.add({ ...widget, pluginId: id })),
        remove: (widget) => this.widgets.remove(widget),
        all: () => this.widgets.all(),
      },
      settings: {
        add: (section) => track(this.settings.add({ ...section, pluginId: id })),
        remove: (section) => this.settings.remove(section),
        all: () => this.settings.all(),
      },
      configs: {
        get: (key) => this.services.get(`config:${key}`),
        set: (key, value) => {
          if (this.services.has(`config:${key}`)) throw new Error(`config already set: ${key}`)
          track(this.services.register(`config:${key}`, value))
        },
      },
      http: {
        request: <T>(path: string, init?: RequestInit) => {
          const client = this.services.get<{ request<T>(path: string, init?: RequestInit): Promise<T> }>('http')
          if (!client) throw new Error('http service is not available')
          return client.request<T>(path, init)
        },
      },
      events: {
        on: (event, handler) => track(this.events.on(event, handler)),
        emit: (event, payload) => this.events.emit(event, payload),
      },
      commands: {
        register: (name, handler) => track(this.commands.register(name, handler)),
        execute: (name, ...args) => this.commands.execute(name, ...args),
        list: () => this.commands.list(),
      },
    }
  }

  private rollback(id: string): void {
    const disposers = this.disposers.get(id) ?? []
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (error) {
        this.options.onError?.(id, error)
      }
    }
    this.disposers.delete(id)
    this.contexts.delete(id)
    const teardown = this.teardowns.get(id)
    if (teardown) {
      this.teardowns.delete(id)
      Promise.resolve(teardown()).catch((error: unknown) => this.options.onError?.(id, error))
    }
    const index = this.startOrder.indexOf(id)
    if (index >= 0) this.startOrder.splice(index, 1)
  }
}
