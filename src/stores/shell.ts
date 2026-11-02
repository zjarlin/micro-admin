// 运行期外壳状态：外壳 schema 的唯一来源（顶栏图标行、侧栏品牌/菜单、内容区皆读它）。
//
// 为什么是 store 而不是 AdminLayout 的局部变量：
// 1. 登录页、设计器的「运行预览」、后续任何壳都要读同一份外壳，第二份真相必然发散；
// 2. 发布外壳后要能「不刷新整页」地生效——设计器发布完调用 `refresh()` 即可。
//
// 兜底策略：后端还没发布任何外壳时，用内置图纸（`createEmptyShellDrawing`）现编译一份，
// 因此「零配置」也能得到一个完整可用的外壳，不会白屏。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/shared/api'
import { compileShellDrawing, createEmptyShellDrawing, type ShellSchema } from '@/shared/shell'
import { createShellApi } from '@/shared/shell/http'

const api = createShellApi(http)

/** 内置外壳 schema：没有已发布外壳时的兜底（与种子图纸等价）。 */
function builtinShell(): ShellSchema {
  return compileShellDrawing(createEmptyShellDrawing()).schema
}

export const useShellStore = defineStore('shell', () => {
  const schema = ref<ShellSchema | null>(null)
  const version = ref(0)
  const key = ref<string | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  let inflight: Promise<void> | null = null

  /** 已生效的外壳：已发布优先，否则内置兜底；保证渲染端永远有壳可用。 */
  const active = computed<ShellSchema>(() => schema.value ?? builtinShell())
  const published = computed(() => schema.value !== null)

  /** 拉取运行期外壳（幂等：并发调用共享同一次请求）。 */
  async function refresh(): Promise<void> {
    if (inflight) return inflight
    loading.value = true
    inflight = (async () => {
      try {
        const config = await api.runtime()
        schema.value = config.shell
        version.value = config.version
        key.value = config.key
      } catch {
        // 拉不到（离线/接口缺失）不是致命错误：保留兜底壳，不打断登录与浏览。
        schema.value = null
        version.value = 0
        key.value = null
      } finally {
        loaded.value = true
        loading.value = false
        inflight = null
      }
    })()
    return inflight
  }

  /** 启动时确保已加载（多次调用只真正请求一次）。 */
  async function ensure(): Promise<void> {
    if (loaded.value) return
    await refresh()
  }

  return { schema, version, key, loaded, loading, active, published, refresh, ensure }
})
