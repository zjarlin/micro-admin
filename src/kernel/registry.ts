import type { ContributionRegistry, EventBus, ServiceRegistry, PluginLogger } from './types'

/** 统一处理重复 token/贡献，避免后加载插件静默覆盖前一个插件。 */
function ensureUnique(existing: boolean, kind: string, key: string): void {
  if (existing) throw new Error(`${kind} already registered: ${key}`)
}

export function createServiceRegistry(): ServiceRegistry {
  const services = new Map<string, unknown>()

  return {
    register<T>(token: string, service: T) {
      ensureUnique(services.has(token), 'service', token)
      services.set(token, service)
      return () => {
        if (services.get(token) === service) services.delete(token)
      }
    },
    get<T>(token: string) {
      return services.get(token) as T | undefined
    },
    require<T>(token: string) {
      const service = services.get(token)
      if (service === undefined) throw new Error(`required service not found: ${token}`)
      return service as T
    },
    has(token: string) {
      return services.has(token)
    },
    list() {
      return [...services.keys()].sort()
    },
  }
}

export function createContributionRegistry<T extends { id?: string; name?: string }>(
  kind: string,
): ContributionRegistry<T> {
  const items: T[] = []

  return {
    add(item: T) {
      // 路由以 name 为身份，其余贡献以 id 为身份。
      const key = item.id ?? item.name ?? JSON.stringify(item)
      const exists = items.some((entry) => (entry.id ?? entry.name) === key)
      ensureUnique(exists, kind, key)
      items.push(item)
      return () => {
        const index = items.indexOf(item)
        if (index >= 0) items.splice(index, 1)
      }
    },
    remove(item: T) {
      const index = items.indexOf(item)
      if (index >= 0) items.splice(index, 1)
    },
    all() {
      return [...items]
    },
  }
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()

  return {
    on<T>(event: string, handler: (payload: T) => void) {
      const bucket = handlers.get(event) ?? new Set()
      bucket.add(handler as (payload: unknown) => void)
      handlers.set(event, bucket)
      return () => {
        bucket.delete(handler as (payload: unknown) => void)
        if (bucket.size === 0) handlers.delete(event)
      }
    },
    emit<T>(event: string, payload: T) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(payload)
    },
  }
}

export function createLogger(id: string): PluginLogger {
  const prefix = `[plugin:${id}]`
  return {
    debug: (message, detail) => console.debug(prefix, message, ...(detail === undefined ? [] : [detail])),
    info: (message, detail) => console.info(prefix, message, ...(detail === undefined ? [] : [detail])),
    warn: (message, detail) => console.warn(prefix, message, ...(detail === undefined ? [] : [detail])),
    error: (message, detail) => console.error(prefix, message, ...(detail === undefined ? [] : [detail])),
  }
}
