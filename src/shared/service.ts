import { inject, type InjectionKey } from 'vue'
import type { CommandRegistry } from '@/kernel'

export const RUNTIME_KEY: InjectionKey<AdminRuntime> = Symbol('micro-admin-runtime')

export interface AdminRuntime {
  service<T>(token: string): T
  command<T = unknown>(name: string, ...args: unknown[]): Promise<T>
  commandNames(): string[]
  pluginEnabled(id: string): boolean
}

export function useRuntime(): AdminRuntime {
  const runtime = inject(RUNTIME_KEY)
  if (!runtime) throw new Error('admin runtime is not provided')
  return runtime
}

export function useService<T>(token: string): T {
  return useRuntime().service<T>(token)
}

export function createRuntime(services: (token: string) => unknown, commands: CommandRegistry, isEnabled: (id: string) => boolean): AdminRuntime {
  return {
    service: <T>(token: string) => {
      const service = services(token)
      if (service === undefined) throw new Error(`service not found: ${token}`)
      return service as T
    },
    command: (name, ...args) => commands.execute(name, ...args),
    commandNames: () => commands.list(),
    pluginEnabled: (id) => isEnabled(id),
  }
}
