import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import { MicroKernel, type PluginStatus } from '@/kernel'

export const useKernelStore = defineStore('kernel', () => {
  const instance = shallowRef<MicroKernel | null>(null)
  const statuses = ref<PluginStatus[]>([])
  const recentErrors = ref<Array<{ pluginId: string; message: string; at: string }>>([])

  function attach(kernel: MicroKernel): void {
    instance.value = markRaw(kernel)
    refresh()
  }

  function refresh(): void {
    statuses.value = instance.value?.list() ?? []
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    if (!instance.value) throw new Error('kernel is not attached')
    if (enabled) await instance.value.enable(id)
    else await instance.value.disable(id)
    refresh()
  }

  function recordError(pluginId: string, error: unknown): void {
    recentErrors.value.unshift({
      pluginId,
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    })
    recentErrors.value = recentErrors.value.slice(0, 20)
  }

  return { instance, statuses, recentErrors, attach, refresh, toggle, recordError }
})
