// 外壳设计器逻辑：图纸装载、几何编辑、属性/事件/模板编辑、编译与发布。
//
// 从页面组件里抽出来，`ShellDesignerPage.vue` 只负责排版与交互入口——
// 这样「外壳图纸怎么改」只有一份实现，页面组件不堆上千行状态机。
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { HttpClient } from '@/shared/http'
import { useService } from '@/shared/service'
import { inspectCode } from '@/shared/ui-canvas'
import {
  createEmptyShellDrawing, defaultShellCodeOf, parseShellDrawing, shellCanConfigure,
  shellEffectiveProps, shellSpecOf, type ShellDrawing, type ShellElement,
  type ShellElementProps, type ShellRole,
} from '@/shared/shell'
import { createShellApi, type ShellCompileResponse, type ShellDrawingDetail } from '@/shared/shell/http'

/** 事件动作可选项（图标点击能配的全部动作）。 */
export const SHELL_ACTIONS = ['navigate', 'request', 'command', 'emit', 'dialog', 'none'] as const

/** 动作参数模板：切到某个动作时给一份可直接改的 JSON 起点，不要空框。 */
export function actionParamsTemplate(action: string): string {
  switch (action) {
    case 'navigate': return JSON.stringify({ path: '/system/notice' }, null, 2)
    case 'request': return JSON.stringify({ method: 'POST', path: '/system/notice', body: {} }, null, 2)
    case 'command': return JSON.stringify({ name: 'kernel.reload-plugins', args: [] }, null, 2)
    case 'emit': return JSON.stringify({ event: 'shell.refresh' }, null, 2)
    case 'dialog': return JSON.stringify({ title: '提示', message: '这是一个可配置弹窗' }, null, 2)
    default: return ''
  }
}

export function useShellDesigner(drawingId: () => number) {
  const api = createShellApi(useService<HttpClient>('http'))

  const drawing = ref<ShellDrawing>(createEmptyShellDrawing())
  const name = ref('')
  const description = ref('')
  const savedVersion = ref(0)
  const selectedIds = ref<string[]>([])
  const zoom = ref(0.7)
  const snap = ref(true)
  const showRegions = ref(true)
  const loading = ref(false)
  const saving = ref(false)
  const publishing = ref(false)
  const dirty = ref(false)
  const railOpen = ref(true)
  const railTab = ref<'palette' | 'tree'>('palette')
  const inspectorOpen = ref(false)
  const inspectorTab = ref<'props' | 'events' | 'vibe' | 'compile'>('props')
  const compileResult = ref<ShellCompileResponse | null>(null)

  const selected = computed<ShellElement | null>(() => {
    if (selectedIds.value.length !== 1) return null
    const id = selectedIds.value[0]
    return id ? (drawing.value.elements.find((element) => element.id === id) ?? null) : null
  })
  const selectedSpec = computed(() => (selected.value ? shellSpecOf(selected.value.role) : null))
  const selectedProps = computed<ShellElementProps>(() => (selected.value ? shellEffectiveProps(selected.value) : {}))
  const canEdit = (key: keyof ShellElementProps): boolean =>
    Boolean(selected.value && shellCanConfigure(selected.value.role, String(key)))

  const diagnostics = computed(() => compileResult.value?.diagnostics ?? [])
  const errors = computed(() => diagnostics.value.filter((item: { level: string }) => item.level === 'error'))
  const analysis = computed(() => compileResult.value?.analysis ?? null)

  /** 元素树：区域 → 其内元素；未归区域的元素不能悄悄消失。 */
  const elementTree = computed(() => {
    const regions = drawing.value.elements.filter((element) => shellSpecOf(element.role).layer === 'region')
    const groups: Array<{ label: string; elements: ShellElement[] }> = []
    const placed = new Set<string>()
    const regionRects = regions.map((element) => ({ role: element.role, rect: element.rect, id: element.id }))
    const containerFor = (element: ShellElement) => {
      const cx = element.rect.x + element.rect.width / 2
      const cy = element.rect.y + element.rect.height / 2
      const sorted = [...regionRects].sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
      return sorted.find((region) => cx >= region.rect.x && cx <= region.rect.x + region.rect.width && cy >= region.rect.y && cy <= region.rect.y + region.rect.height)
    }
    for (const region of ['sidebar', 'topbar', 'content'] as ShellRole[]) {
      const container = regions.find((element) => element.role === region)
      if (!container) continue
      const children = drawing.value.elements.filter(
        (element) => element.id !== container.id && shellSpecOf(element.role).layer !== 'region' && containerFor(element)?.role === region,
      )
      for (const child of children) placed.add(child.id)
      groups.push({ label: `${shellSpecOf(container.role).label} · ${container.id}`, elements: children })
    }
    const orphans = drawing.value.elements.filter((element) => !placed.has(element.id) && shellSpecOf(element.role).layer !== 'region')
    if (orphans.length) groups.push({ label: '未归区域', elements: orphans })
    return groups
  })

  async function load(): Promise<void> {
    if (!drawingId()) return
    loading.value = true
    try {
      const detail: ShellDrawingDetail = await api.detail(drawingId())
      name.value = detail.name
      description.value = detail.description ?? ''
      drawing.value = parseShellDrawing(detail.drawingJson)
      savedVersion.value = detail.version
      dirty.value = false
      await recompile()
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '外壳图纸读取失败')
    } finally {
      loading.value = false
    }
  }

  /** 现算编译：本地即时，不落库，因此每次拖动都能看到顶栏左右排布的变化。 */
  async function recompile(): Promise<void> {
    try {
      compileResult.value = await api.compile({ drawingJson: JSON.stringify(drawing.value) })
    } catch {
      compileResult.value = null
    }
  }

  let timer: number | null = null
  function scheduleRecompile(): void {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void recompile()
    }, 260)
  }

  function markDirty(): void {
    dirty.value = true
  }

  watch(drawing, () => {
    if (loading.value) return
    dirty.value = true
    scheduleRecompile()
  }, { deep: true })

  function dispose(): void {
    if (timer !== null) window.clearTimeout(timer)
  }

  // ---------------- 几何 ----------------

  function onRect(id: string, rect: ShellElement['rect']): void {
    const element = drawing.value.elements.find((item) => item.id === id)
    if (!element) return
    element.rect = rect
    markDirty()
  }

  function addRole(role: ShellRole, point?: { x: number; y: number }): void {
    const spec = shellSpecOf(role)
    const id = `${role}-${Date.now().toString(36)}`
    const element: ShellElement = {
      id,
      role,
      rect: {
        x: Math.round(point?.x ?? 40),
        y: Math.round(point?.y ?? 40),
        width: spec.defaultWidth,
        height: spec.defaultHeight,
      },
      zIndex: drawing.value.elements.length,
      text: spec.defaultText,
      props: {},
      bindings: [],
      locked: false,
      visible: true,
    }
    drawing.value.elements.push(element)
    selectedIds.value = [id]
    markDirty()
  }

  function removeSelected(): void {
    if (!selectedIds.value.length) return
    drawing.value.elements = drawing.value.elements.filter((element) => !selectedIds.value.includes(element.id))
    selectedIds.value = []
    markDirty()
  }

  function duplicateSelected(): void {
    if (!selected.value) return
    const copy: ShellElement = {
      ...structuredClone(selected.value),
      id: `${selected.value.role}-${Date.now().toString(36)}`,
      rect: { ...selected.value.rect, x: selected.value.rect.x + 20, y: selected.value.rect.y + 20 },
      zIndex: drawing.value.elements.length,
    }
    drawing.value.elements.push(copy)
    selectedIds.value = [copy.id]
    markDirty()
  }

  function toggleVisible(): void {
    if (!selected.value) return
    selected.value.visible = selected.value.visible === false
    markDirty()
  }

  // ---------------- 属性 ----------------

  function setProp(key: keyof ShellElementProps, value: unknown): void {
    if (!selected.value) return
    if (value === '' || value === undefined || value === null) delete selected.value.props[key]
    else (selected.value.props as Record<string, unknown>)[key] = value
    markDirty()
  }

  function jsonPropOf(key: keyof ShellElementProps): string {
    const value = selectedProps.value[key]
    return value === undefined ? '' : JSON.stringify(value, null, 2)
  }

  function setJsonProp(key: keyof ShellElementProps, text: string): void {
    if (!text.trim()) { setProp(key, null); return }
    try {
      setProp(key, JSON.parse(text))
    } catch {
      ElMessage.warning(`${key} 不是合法 JSON，未写入`)
    }
  }

  function setMeta(key: 'key' | 'title' | 'description', value: string): void {
    if (key === 'description') drawing.value.meta.description = value
    else drawing.value.meta[key] = value
    markDirty()
  }

  // ---------------- 点击事件（本任务核心） ----------------

  /** 当前元素的点击绑定（外壳只有 click 一个事件通道）。 */
  const clickBinding = computed(() => selected.value?.bindings.find((binding) => binding.kind === 'event' && binding.channel === 'click') ?? null)

  /** 确保存在点击绑定（配置动作时调用）。 */
  function ensureClickBinding(): void {
    if (!selected.value) return
    if (!clickBinding.value) {
      selected.value.bindings.push({ kind: 'event', channel: 'click', action: 'navigate', params: { path: '/dashboard' } })
      markDirty()
    }
  }

  function setAction(action: string): void {
    ensureClickBinding()
    const binding = clickBinding.value
    if (!binding || !selected.value) return
    binding.action = action as NonNullable<typeof binding.action>
    if (action === 'none') { delete binding.params; delete binding.confirm }
    else if (action === 'navigate' && !binding.params?.path) {
      binding.params = { path: '/dashboard' }
    }
    markDirty()
  }

  function setActionParams(text: string): void {
    const binding = clickBinding.value
    if (!binding) return
    if (!text.trim()) { delete binding.params; markDirty(); return }
    try {
      binding.params = JSON.parse(text) as Record<string, unknown>
      markDirty()
    } catch {
      ElMessage.warning('动作参数不是合法 JSON，未写入')
    }
  }

  function setConfirm(text: string): void {
    const binding = clickBinding.value
    if (!binding) return
    if (text.trim()) binding.confirm = text
    else delete binding.confirm
    markDirty()
  }

  function actionParamsText(): string {
    const params = clickBinding.value?.params
    return params ? JSON.stringify(params, null, 2) : ''
  }

  function clearClickBinding(): void {
    if (!selected.value) return
    selected.value.bindings = selected.value.bindings.filter((binding) => !(binding.kind === 'event' && binding.channel === 'click'))
    markDirty()
  }

  /** 元素当前的在线模板与安全检查结论（属性面板里即时回显）。 */
  const codeIssues = computed(() => inspectCode(String(selectedProps.value.code ?? '')))
  function ensureCode(): void {
    if (!selected.value) return
    if (!String(selectedProps.value.code ?? '').trim()) setProp('code', defaultShellCodeOf(selected.value))
  }

  // ---------------- 检查器 ----------------

  function openInspector(tab: 'props' | 'events' | 'vibe' | 'compile' = 'props', elementId?: string): void {
    if (elementId) selectedIds.value = [elementId]
    inspectorTab.value = tab
    inspectorOpen.value = true
  }

  function openShellSettings(): void {
    selectedIds.value = []
    openInspector('props')
  }

  const inspectorTitle = computed(() => (selected.value
    ? `${selectedSpec.value?.label ?? '元素'} · ${selected.value.id}`
    : `外壳设置 · ${drawing.value.meta.key || '未命名'}`))

  function openElement(elementId: string): void { openInspector('props', elementId) }

  // ---------------- 缩放 ----------------

  const viewport = ref<HTMLElement | null>(null)
  const ZOOM_MIN = 0.2
  const ZOOM_MAX = 2

  function applyZoom(next: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100))
    const host = viewport.value
    if (host && clamped !== zoom.value) {
      const ratio = clamped / zoom.value
      const cx = host.scrollLeft + host.clientWidth / 2
      const cy = host.scrollTop + host.clientHeight / 2
      zoom.value = clamped
      void nextTick(() => {
        host.scrollLeft = cx * ratio - host.clientWidth / 2
        host.scrollTop = cy * ratio - host.clientHeight / 2
      })
      return
    }
    zoom.value = clamped
  }

  function zoomIn(): void { applyZoom(zoom.value * 1.2) }
  function zoomOut(): void { applyZoom(zoom.value / 1.2) }
  function zoomFit(): void {
    const host = viewport.value
    if (!host) return
    const fit = Math.min(
      (host.clientWidth - 32) / drawing.value.canvas.width,
      (host.clientHeight - 32) / drawing.value.canvas.height,
    )
    applyZoom(Math.min(1, Math.max(ZOOM_MIN, fit)))
  }

  // ---------------- 保存 / 发布 ----------------

  async function save(): Promise<void> {
    if (!drawingId()) return
    saving.value = true
    try {
      const detail = await api.update({
        id: drawingId(),
        name: name.value,
        description: description.value,
        drawingJson: JSON.stringify(drawing.value),
      })
      savedVersion.value = detail.version
      dirty.value = false
      ElMessage.success('已保存')
      await recompile()
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '保存失败')
      throw error
    } finally {
      saving.value = false
    }
  }

  async function publish(): Promise<void> {
    if (dirty.value) await save()
    publishing.value = true
    try {
      const result = await api.publish(drawingId())
      ElMessage.success(`外壳已发布（v${result.version}）：刷新或重新登录后按新外壳渲染`)
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '发布失败')
    } finally {
      publishing.value = false
    }
  }

  async function unpublish(): Promise<void> {
    try {
      await ElMessageBox.confirm('下线后运行期会退回内置外壳（图纸保留）。确定下线？', '下线外壳', {
        type: 'warning', confirmButtonText: '下线', cancelButtonText: '取消',
      })
    } catch {
      return
    }
    try {
      const result = await api.unpublish(drawingId())
      ElMessage.success(result.removed ? `已下线 ${result.key}` : '当前没有已发布外壳')
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '下线失败')
    }
  }

  return {
    drawing, name, description, savedVersion, selectedIds, zoom, snap, showRegions,
    loading, saving, publishing, dirty, railOpen, railTab, inspectorOpen, inspectorTab,
    compileResult, selected, selectedSpec, selectedProps, canEdit, diagnostics, errors, analysis,
    elementTree, viewport,
    load, dispose, onRect, addRole, removeSelected, duplicateSelected, toggleVisible,
    setProp, jsonPropOf, setJsonProp, setMeta,
    clickBinding, ensureClickBinding, setAction, setActionParams, setConfirm, actionParamsText, clearClickBinding,
    codeIssues, ensureCode,
    openInspector, openShellSettings, inspectorTitle, openElement, markDirty,
    applyZoom, zoomIn, zoomOut, zoomFit,
    save, publish, unpublish,
  }
}
