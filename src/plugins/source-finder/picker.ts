// 源定位器的运行时：全站唯一一个拾取器实例。
//
// 为什么归服务而不是归按钮组件：拾取器一旦激活就接管全局指针与快捷键，
// 路由切换、顶栏重渲染都不该把它杀掉（否则点一下菜单就退出拾取模式）。
// 按钮只调用 `toggle()`，与快捷键走同一条路径，两边共享同一个激活状态。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import {
  createSourcePicker,
  type PageOrigin,
  type PickedDetail,
  type SourcePicker,
} from '@zjarlin/source-locator/browser'

export interface SourceFinderRuntime {
  readonly active: ComputedRef<boolean>
  readonly lastPick: Ref<PickedDetail | null>
  toggle(): void
  enable(): void
  disable(): void
  dispose(): void
}

export interface SourceFinderOptions {
  /** 读取当前路由；点击卡片时用来回答「这一页来自哪里」。 */
  route?: () => RouteLocationNormalizedLoaded | null
  /** schema 基线注册表文件（相对路径）；宿主自己知道，插件不写死路径。 */
  schemaIndexFile?: string
}

/**
 * 回答「这一页来自哪里」。
 *
 * 配置驱动的页面没有业务 `.vue`：元素只能定位到渲染壳（`CrudPage.vue`），
 * 真正的定义在后端下发的 schema 里。因此优先用元素现场读到的 `page-key`，
 * 读不到再退回路由 meta，最后才按插件目录回答。
 */
function pageOrigin(
  picked: PickedDetail,
  route: RouteLocationNormalizedLoaded | null,
  schemaIndexFile: string | undefined,
): PageOrigin | null {
  const meta = (route?.meta ?? {}) as { pageKey?: unknown; pluginId?: unknown; title?: unknown }
  const title = typeof meta.title === 'string' ? meta.title : ''
  const metaKey = typeof meta.pageKey === 'string' ? meta.pageKey : ''
  // 元素现场比路由 meta 更准：一个 `.vue` 壳里可能挂多个 schema（页面工厂就是这样）。
  const key = picked.schemaKeys[0] ?? metaKey

  if (key) {
    // schema 的定义分两段：代码里的基线（key → 对象）与运行期的覆盖层（存在 SQLite）。
    // 因此这里只给出基线注册表这一处真实入口，不猜「key 对应哪个 .ts」。
    return {
      label: `配置驱动页面「${title || key}」`,
      detail: `schema key = ${key}；基线与运行期覆盖层在同一个注册表里`,
      ...(schemaIndexFile ? { files: [schemaIndexFile] } : {}),
    }
  }

  const pluginId = typeof meta.pluginId === 'string' ? meta.pluginId : ''
  if (pluginId) {
    return {
      label: `插件页面${title ? `「${title}」` : ''}`,
      detail: `插件 id = ${pluginId}；路由与页面见 src/plugins/${pluginId}/`,
    }
  }
  return null
}

export function createSourceFinderRuntime(options: SourceFinderOptions = {}): SourceFinderRuntime {
  const active = ref(false)
  const lastPick = ref<PickedDetail | null>(null)

  const picker: SourcePicker = createSourcePicker({
    // 拾取结果留给需要联动的宿主能力（例如把位置写进右栏），当前只做本地记录。
    onPick: (detail) => {
      lastPick.value = detail
    },
    onChange: (value) => {
      active.value = value
    },
    describePage: (picked) => pageOrigin(picked, options.route?.() ?? null, options.schemaIndexFile),
  })

  return {
    active: computed(() => active.value),
    lastPick,
    toggle: () => picker.toggle(),
    enable: () => picker.enable(),
    disable: () => picker.disable(),
    dispose: () => picker.destroy(),
  }
}
