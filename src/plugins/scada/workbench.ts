// 组态工作台的公开句柄：插件之间只通过这个接口协作。
//
// 为什么需要它：AI 助手（另一个插件）要给画布加图元，但不能 import 页面组件，
// 也不该复制一份画布状态。页面在挂载时把自己的读写能力挂到这里，其它插件按接口取用；
// 页面卸载即解绑，插件据此判断「当前有没有画布可用」。
//
// 本仓库的外壳由图纸下发，没有 app-frame 右栏，因此这里只保留「读写画布」这一件事：
// 右栏开关属于页面自己的事（`sidePanel`），不需要跨插件协作。
import { computed, ref } from 'vue'
import type { ScadaDocument, ScadaSymbolDefinition, ScadaTagOption } from '@/shared/scada/types'

export interface ScadaWorkbenchHandle {
  /** 当前文档（只读快照，调用方不要就地改）。 */
  readDocument: () => ScadaDocument
  readSymbols: () => ScadaSymbolDefinition[]
  readTags: () => ScadaTagOption[]
  readSelection: () => string[]
  /** 用新文档替换画布内容，并标记为未保存。 */
  writeDocument: (document: ScadaDocument) => void
  /** 当前打开的画面 id；没有打开画面时为 null。 */
  readScreenId: () => number | null
  /** 重新从后端拉当前画面（服务端改过画面之后用）。 */
  reload: () => Promise<void>
}

const handle = ref<ScadaWorkbenchHandle | null>(null)

/** 页面挂载时调用；返回解绑函数（页面卸载时执行）。 */
export function attachScadaWorkbench(next: ScadaWorkbenchHandle): () => void {
  handle.value = next
  return () => {
    if (handle.value === next) handle.value = null
  }
}

/** 其它插件用这个读工作台；`active` 为 false 时说明当前没有打开的组态画面。 */
export function useScadaWorkbench() {
  return {
    handle,
    active: computed(() => handle.value !== null),
  }
}
