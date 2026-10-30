<script setup lang="ts">
// 图纸设计器：左边双栏菜单（角色库 + 结构树），中间画布，右边属性 / 绑定 / 编译结果，底部实时预览。
//
// 「实时」体现在两处：
// 1. 画布上的几何改动即时反映到右侧编译结果与底部运行预览（同一次编译，不重复求值）；
// 2. vibeelement 的模板片段在面板里就地渲染，改一个字就能看到元素长什么样。
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Delete, DocumentAdd, Link, MagicStick, Promotion, Refresh, SortDown, SortUp, Stamp, View,
} from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import {
  ROLE_LIST, channelsOf, createEmptyDrawing, defaultCodeOf, effectiveProps, isContainer,
  findElement, handlerNamesOf, inspectCode, modelOf, regionsOf, specOf, validateBindings,
  type UiDiagnostic, type UiDrawing, type UiElement, type UiElementProps, type UiQuestion, type UiRect, type UiRole,
} from '@/shared/ui-canvas'
import type { UiCompileResponse } from '@/shared/ui-canvas/http'
import { createUiCanvasApi, parseDrawing } from '@/shared/ui-canvas/http'
import DrawingCanvas from '@/components/ui-canvas/DrawingCanvas.vue'
import VibeElement from '@/components/ui-canvas/VibeElement.vue'

const route = useRoute()
const router = useRouter()
const api = createUiCanvasApi(useService<HttpClient>('http'))

const drawingId = computed(() => Number(route.query.id ?? 0))

const drawing = ref<UiDrawing>(createEmptyDrawing())
const name = ref('')
const description = ref('')
const savedVersion = ref(0)
const selectedIds = ref<string[]>([])
const zoom = ref(0.62)
const snap = ref(true)
const showRegions = ref(false)
const saving = ref(false)
const publishing = ref(false)
const asking = ref(false)
const loading = ref(false)
const compileResult = ref<UiCompileResponse | null>(null)
const dirty = ref(false)
/** 属性面板页签：属性 / 数据 / 事件 / 模板。 */
const inspectorTab = ref('props')

const selected = computed<UiElement | null>(() => {
  if (selectedIds.value.length !== 1) return null
  const id = selectedIds.value[0]
  return id ? (findElement(drawing.value, id) ?? null) : null
})

const selectedSpec = computed(() => (selected.value ? specOf(selected.value.role) : null))
const selectedProps = computed<UiElementProps>(() => (selected.value ? effectiveProps(selected.value) : {}))
const selectedChannels = computed(() => (selected.value ? channelsOf(selected.value) : []))
const selectedHandlers = computed(() => (selected.value ? handlerNamesOf(selected.value) : {}))

/**
 * 元素树：容器进「页面骨架」，叶子按所属区域归组，编辑器里一眼看清「谁在哪个区域里」。
 *
 * 顺序沿用图纸的区域装配结果（大区域在前），因此和右侧编译出的「区域 → 元素」一致。
 */
const elementTree = computed(() => {
  const regions = regionsOf(drawing.value)
  const groups: Array<{ label: string; elements: UiElement[] }> = []

  const containers = drawing.value.elements.filter((element) => isContainer(element))
  if (containers.length) groups.push({ label: '页面骨架', elements: containers })

  for (const region of regions) {
    const children = region.childIds
      .map((id) => findElement(drawing.value, id))
      .filter((element): element is UiElement => Boolean(element))
    if (!children.length) continue
    groups.push({ label: `${specOf(region.role).label} · ${region.id}`, elements: children })
  }

  // 兜底：既不是容器、也没落进任何区域的元素，不能悄悄消失。
  const placed = new Set([...containers, ...groups.flatMap((group) => group.elements)].map((element) => element.id))
  const orphans = drawing.value.elements.filter((element) => !placed.has(element.id))
  if (orphans.length) groups.push({ label: '未归区域', elements: orphans })

  return groups
})

const diagnostics = computed<UiDiagnostic[]>(() => compileResult.value?.diagnostics ?? [])
const errors = computed(() => diagnostics.value.filter((item) => item.level === 'error'))
const questions = computed<UiQuestion[]>(() => compileResult.value?.questions ?? [])

/** 用当前图纸现算 vibeelement 的绑定/模板问题（比等编译更即时）。 */
const selectedIssues = computed(() => {
  if (!selected.value) return [] as string[]
  const issues: string[] = []
  for (const issue of validateBindings(selected.value)) {
    if (issue.level === 'error') issues.push(issue.message)
  }
  for (const issue of inspectCode(String(selectedProps.value.code ?? ''))) {
    issues.push(issue.message)
  }
  return issues
})

async function load(): Promise<void> {
  if (!drawingId.value) return
  loading.value = true
  try {
    const detail = await api.detail(drawingId.value)
    name.value = detail.name
    description.value = detail.description ?? ''
    drawing.value = parseDrawing(detail.drawingJson)
    savedVersion.value = detail.version
    dirty.value = false
    await recompile()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸读取失败')
  } finally {
    loading.value = false
  }
}

/** 现算编译：不落库，纯本地，因此每次拖动都能即时看到结果。 */
async function recompile(): Promise<void> {
  try {
    compileResult.value = await api.compile({ drawingJson: JSON.stringify(drawing.value) })
  } catch (error) {
    compileResult.value = null
    void error
  }
}

let recompileTimer: number | null = null
function scheduleRecompile(): void {
  if (recompileTimer !== null) window.clearTimeout(recompileTimer)
  recompileTimer = window.setTimeout(() => {
    recompileTimer = null
    void recompile()
  }, 260)
}

watch(() => drawing.value, () => {
  dirty.value = true
  scheduleRecompile()
}, { deep: true })

function markDirty(): void {
  dirty.value = true
}

// ---------------- 画布交互 ----------------

function onElementRect(id: string, rect: UiRect): void {
  const element = findElement(drawing.value, id)
  if (!element) return
  element.rect = rect
  markDirty()
}

function addRole(role: UiRole, point?: { x: number; y: number }): void {
  const spec = specOf(role)
  const id = `el-${Date.now().toString(36)}`
  const element: UiElement = {
    id,
    role,
    rect: {
      x: Math.round(point?.x ?? 40 / 1),
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
  const source = selected.value
  if (!source) return
  const copy: UiElement = {
    ...structuredClone(source),
    id: `el-${Date.now().toString(36)}`,
    rect: { ...source.rect, x: source.rect.x + 20, y: source.rect.y + 20 },
    zIndex: drawing.value.elements.length,
  }
  drawing.value.elements.push(copy)
  selectedIds.value = [copy.id]
  markDirty()
}

function bringForward(): void {
  const element = selected.value
  if (!element) return
  element.zIndex = Math.max(...drawing.value.elements.map((item) => item.zIndex)) + 1
  markDirty()
}

function sendBackward(): void {
  const element = selected.value
  if (!element) return
  element.zIndex = Math.min(...drawing.value.elements.map((item) => item.zIndex)) - 1
  markDirty()
}

function toggleLock(): void {
  const element = selected.value
  if (!element) return
  element.locked = !element.locked
  markDirty()
}

// ---------------- 属性编辑 ----------------

function setProp(key: keyof UiElementProps, value: unknown): void {
  const element = selected.value
  if (!element) return
  if (value === '' || value === undefined || value === null) delete element.props[key]
  else (element.props as Record<string, unknown>)[key] = value
  markDirty()
}

/** JSON 类属性（options / request / tagMap / resolveFrom）在面板里按 JSON 文本编辑。 */
function jsonPropOf(key: keyof UiElementProps): string {
  const value = selectedProps.value[key]
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function setJsonProp(key: keyof UiElementProps, text: string): void {
  if (!text.trim()) {
    setProp(key, null)
    return
  }
  try {
    setProp(key, JSON.parse(text))
  } catch {
    ElMessage.warning(`${key} 不是合法 JSON，未写入`)
  }
}

function setMeta(key: 'key' | 'title' | 'endpoint' | 'entity', value: string): void {
  drawing.value.meta[key] = value
  markDirty()
}

// ---------------- vibeelement ----------------

function ensureCode(): void {
  const element = selected.value
  if (!element) return
  if (!String(selectedProps.value.code ?? '').trim()) {
    setProp('code', defaultCodeOf(element))
  }
}

function addBinding(kind: 'data' | 'event', channel: string): void {
  const element = selected.value
  if (!element) return
  if (element.bindings.some((binding) => binding.channel === channel)) {
    ElMessage.info(`通道 ${channel} 已经挂过了`)
    return
  }
  element.bindings.push(
    kind === 'data'
      ? { kind, channel, source: '' }
      : { kind, channel, action: channel === 'click' ? 'dialog' : 'reload' },
  )
  markDirty()
}

function removeBinding(index: number): void {
  const element = selected.value
  if (!element) return
  element.bindings.splice(index, 1)
  markDirty()
}

function setBindingField(index: number, field: 'source' | 'action', value: string): void {
  const element = selected.value
  if (!element) return
  const binding = element.bindings[index]
  if (!binding) return
  if (field === 'source') {
    if (value) binding.source = value
    else delete binding.source
  } else {
    binding.action = value as NonNullable<typeof binding.action>
  }
  markDirty()
}

/** 事件动作参数（request 的 method/path、navigate 的 path）用 JSON 编辑。 */
function setBindingParams(index: number, text: string): void {
  const element = selected.value
  if (!element) return
  const binding = element.bindings[index]
  if (!binding) return
  if (!text.trim()) {
    delete binding.params
    markDirty()
    return
  }
  try {
    binding.params = JSON.parse(text) as Record<string, unknown>
    markDirty()
  } catch {
    ElMessage.warning('动作参数不是合法 JSON，未写入')
  }
}

/** 预览用的事件处理器：真实动作由运行期宿主提供，这里只回显触发了哪个通道。 */
const vibeHandlers = computed<Record<string, (payload?: unknown) => void>>(() => {
  const out: Record<string, (payload?: unknown) => void> = {}
  for (const channel of selectedChannels.value) {
    if (channel.kind !== 'event') continue
    out[channel.channel] = () => ElMessage.info(`触发事件通道 ${channel.channel}`)
  }
  return out
})

/** vibeelement 的预览数据：用当前选中元素 + 一行示例值，直接看模板渲染成什么。 */
const vibePreview = computed(() => {
  if (!selected.value) return null
  const props = selectedProps.value
  return modelOf(selected.value, {
    data: {
      value: props.value ?? '示例值',
      text: String(props.label ?? selected.value.text ?? '示例文本'),
      total: 18,
    },
    handlers: selectedHandlers.value,
  })
})

// ---------------- 保存 / 发布 / AI ----------------

async function save(): Promise<void> {
  if (!drawingId.value) return
  saving.value = true
  try {
    const detail = await api.update({
      id: drawingId.value,
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
  } finally {
    saving.value = false
  }
}

async function publish(): Promise<void> {
  if (dirty.value) await save()
  publishing.value = true
  try {
    const result = await api.publish(drawingId.value)
    ElMessage.success(`已发布为页面 ${result.key}（schema v${result.version}），侧栏与路由下次加载即可看到`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发布失败')
  } finally {
    publishing.value = false
  }
}

async function unpublish(): Promise<void> {
  try {
    await ElMessageBox.confirm('下线会把该页面从后端注册表移除（图纸保留）。确定下线？', '下线页面', {
      type: 'warning', confirmButtonText: '下线', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const result = await api.unpublish(drawingId.value)
    ElMessage.success(result.removed ? `已下线 ${result.key}` : '该图纸尚未发布')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下线失败')
  }
}

async function askAi(): Promise<void> {
  if (dirty.value) await save()
  asking.value = true
  try {
    const result = await api.ask(drawingId.value)
    if (!result.ai.called) {
      ElMessage.info('当前规则表已覆盖全部元素，不需要追问模型')
    } else {
      ElMessage.success(`模型回填 ${result.applied} 个字段${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ''}`)
      if (result.drawingJson) drawing.value = parseDrawing(result.drawingJson)
      await recompile()
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '追问失败')
  } finally {
    asking.value = false
  }
}

/** 运行预览：把编译出的 schema 直接交给通用页面壳渲染，所见即上线后。 */
function openRun(): void {
  void router.push({ name: 'ui-canvas-run', query: { id: String(drawingId.value) } })
}

async function sendToGroup(role: UiRole): Promise<void> {
  addRole(role, { x: 60, y: 200 + drawing.value.elements.length * 8 })
}

onMounted(load)
onBeforeUnmount(() => {
  if (recompileTimer !== null) window.clearTimeout(recompileTimer)
})
</script>

<template>
  <div class="page ui-designer" v-loading="loading">
    <header class="page-head">
      <div class="crud-head">
        <el-button text :icon="ArrowLeft" @click="router.push({ name: 'ui-canvas-gallery' })">图纸库</el-button>
        <h1>{{ name || '未命名图纸' }}</h1>
        <el-tag v-if="dirty" size="small" type="warning">未保存</el-tag>
        <el-tag v-else size="small" type="info">v{{ savedVersion }}</el-tag>
        <el-tag v-if="errors.length" size="small" type="danger">{{ errors.length }} 处错误</el-tag>
      </div>
      <div class="page-actions">
        <el-button :icon="View" @click="openRun">运行预览</el-button>
        <el-button :icon="MagicStick" :loading="asking" @click="askAi">
          问模型补参{{ questions.length ? `（${questions.length}）` : '' }}
        </el-button>
        <el-button :icon="Refresh" :loading="saving" @click="save">保存</el-button>
        <el-button :icon="Stamp" type="primary" :loading="publishing" @click="publish">发布页面</el-button>
        <el-button v-if="compileResult?.key" text type="danger" @click="unpublish">下线</el-button>
      </div>
    </header>

    <div class="designer-layout">
      <!-- 左：双栏菜单（角色库 + 结构树） -->
      <aside class="panel designer-menu">
        <div class="menu-column menu-column--roles">
          <div class="menu-title">元素</div>
          <div class="role-groups">
            <div v-for="layer in ['container', 'leaf', 'band'] as const" :key="layer" class="role-group">
              <span class="role-group__label">
                {{ layer === 'container' ? '容器' : layer === 'leaf' ? '数据元素' : '装饰' }}
              </span>
              <button
                v-for="spec in ROLE_LIST.filter((item) => item.layer === layer)"
                :key="spec.role"
                class="role-chip"
                type="button"
                :style="{ borderColor: spec.tint }"
                :title="`${spec.label}：${spec.description}`"
                :disabled="!(layer === 'container' || drawing.meta.endpoint)"
                draggable="true"
                @click="sendToGroup(spec.role)"
                @dragstart="($event.dataTransfer?.setData('application/x-ui-role', spec.role))"
              >
                <span class="role-chip__dot" :style="{ background: spec.tint }" />
                {{ spec.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="menu-column menu-column--tree">
          <div class="menu-title">
            结构
            <span class="muted">{{ drawing.elements.length }} 元素</span>
          </div>
          <el-scrollbar class="tree-scroll">
            <div v-for="group in elementTree" :key="group.label" class="tree-group">
              <div class="tree-group__label">{{ group.label }}</div>
              <button
                v-for="element in group.elements"
                :key="element.id"
                type="button"
                class="tree-row"
                :class="{ 'is-active': selectedIds.includes(element.id) }"
                @click="selectedIds = [element.id]"
              >
                <span class="tree-row__dot" :style="{ background: specOf(element.role).tint }" />
                <span class="tree-row__text">
                  {{ effectiveProps(element).label ?? element.text ?? specOf(element.role).label }}
                </span>
                <span class="tree-row__role">{{ specOf(element.role).label }}</span>
              </button>
            </div>
            <p v-if="!drawing.elements.length" class="muted empty-hint">从左边点一个元素开始画。</p>
          </el-scrollbar>
        </div>
      </aside>

      <!-- 中：画布 -->
      <section class="panel designer-canvas">
        <div class="canvas-toolbar">
          <el-button-group>
            <el-button size="small" :icon="DocumentAdd" @click="duplicateSelected" :disabled="!selected">复制</el-button>
            <el-button size="small" :icon="SortUp" @click="bringForward" :disabled="!selected">上移</el-button>
            <el-button size="small" :icon="SortDown" @click="sendBackward" :disabled="!selected">下移</el-button>
            <el-button size="small" :icon="Delete" type="danger" @click="removeSelected" :disabled="!selectedIds.length">删除</el-button>
          </el-button-group>
          <el-checkbox v-model="snap" label="吸附" />
          <el-checkbox v-model="showRegions" label="区域线" />
          <el-slider v-model="zoom" :min="0.2" :max="1.4" :step="0.02" style="width: 140px" />
          <span class="muted">{{ Math.round(zoom * 100) }}%</span>
          <span class="muted">{{ drawing.canvas.width }} × {{ drawing.canvas.height }}</span>
        </div>
        <el-scrollbar class="canvas-scroll">
          <DrawingCanvas
            :drawing="drawing"
            :selected-ids="selectedIds"
            :zoom="zoom"
            :snap="snap"
            :show-regions="showRegions"
            @update:selected-ids="selectedIds = $event"
            @update="onElementRect"
            @drop-role="addRole"
          />
        </el-scrollbar>
      </section>

      <!-- 右：属性 / 绑定 / 编译结果 -->
      <aside class="panel designer-inspector">
        <el-tabs v-model="inspectorTab" class="inspector-tabs">
          <el-tab-pane label="属性" name="props">
            <template v-if="!selected">
              <p class="muted empty-hint">选中一个元素后在这里配置；多选时只显示数量（{{ selectedIds.length }}）。</p>
              <el-divider />
              <div class="form-block">
                <span class="form-label">页面 key</span>
                <el-input :model-value="drawing.meta.key" @update:model-value="setMeta('key', $event)" placeholder="system.user" />
              </div>
              <div class="form-block">
                <span class="form-label">页面标题</span>
                <el-input :model-value="drawing.meta.title" @update:model-value="setMeta('title', $event)" placeholder="用户管理" />
              </div>
              <div class="form-block">
                <span class="form-label">列表接口</span>
                <el-input :model-value="drawing.meta.endpoint ?? ''" @update:model-value="setMeta('endpoint', $event)" placeholder="/system/users" />
              </div>
              <div class="form-block">
                <span class="form-label">实体名</span>
                <el-input :model-value="drawing.meta.entity ?? ''" @update:model-value="setMeta('entity', $event)" placeholder="用户" />
              </div>
            </template>
            <template v-else>
              <div class="inspector-head">
                <strong>{{ selectedSpec?.label }}</strong>
                <span class="muted">{{ selected.id }}</span>
                <el-tag size="small" :type="selected.locked ? 'info' : 'success'">{{ selected.locked ? '已锁定' : '可编辑' }}</el-tag>
              </div>
              <p class="muted inspector-desc">{{ selectedSpec?.description }}</p>

              <div class="form-block">
                <span class="form-label">文案</span>
                <el-input :model-value="selected.text" @update:model-value="selected.text = $event; markDirty()" />
              </div>

              <div v-if="selectedSpec?.editable.includes('label')" class="form-block">
                <span class="form-label">标签 label</span>
                <el-input :model-value="String(selectedProps.label ?? '')" @update:model-value="setProp('label', $event)" />
              </div>
              <div v-if="selectedSpec?.editable.includes('prop')" class="form-block">
                <span class="form-label">字段 prop</span>
                <el-input :model-value="String(selectedProps.prop ?? '')" @update:model-value="setProp('prop', $event)" placeholder="nickname" />
              </div>
              <div v-if="selectedSpec?.editable.includes('help')" class="form-block">
                <span class="form-label">说明</span>
                <el-input :model-value="String(selectedProps.help ?? '')" @update:model-value="setProp('help', $event)" />
              </div>

              <!-- 列 -->
              <template v-if="selected.role === 'column'">
                <div class="form-block">
                  <span class="form-label">单元格语义</span>
                  <el-select :model-value="selectedProps.cell ?? 'text'" @update:model-value="setProp('cell', $event)">
                    <el-option v-for="kind in ['text','code','status','tagMap','datetime','dict','link','custom']" :key="kind" :label="kind" :value="kind" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">对齐</span>
                  <el-select :model-value="selectedProps.align ?? 'left'" @update:model-value="setProp('align', $event)">
                    <el-option label="左" value="left" /><el-option label="中" value="center" /><el-option label="右" value="right" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">固定</span>
                  <el-select :model-value="selectedProps.fixed ?? ''" @update:model-value="setProp('fixed', $event)" clearable>
                    <el-option label="不固定" value="" /><el-option label="左" value="left" /><el-option label="右" value="right" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">状态映射 tagMap（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('tagMap')" @update:model-value="setJsonProp('tagMap', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">跨资源取值 resolveFrom（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('resolveFrom')" @update:model-value="setJsonProp('resolveFrom', $event)" />
                </div>
              </template>

              <!-- 字段 -->
              <template v-if="selected.role === 'field'">
                <div class="form-block">
                  <span class="form-label">控件</span>
                  <el-select :model-value="selectedProps.control ?? 'input'" @update:model-value="setProp('control', $event)">
                    <el-option v-for="control in ['input','password','textarea','number','select','radio','switch','treeSelect','date']" :key="control" :label="control" :value="control" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">必填</span>
                  <el-switch :model-value="Boolean(selectedProps.required)" @update:model-value="setProp('required', $event)" />
                  <span class="muted hint">必填会同时生成标签星号与校验规则</span>
                </div>
                <div class="form-block">
                  <span class="form-label">编辑时禁用</span>
                  <el-switch :model-value="Boolean(selectedProps.disabledOnEdit)" @update:model-value="setProp('disabledOnEdit', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">栅格跨度</span>
                  <el-radio-group :model-value="selectedProps.span ?? 24" @update:model-value="setProp('span', $event)">
                    <el-radio :value="12">半行</el-radio><el-radio :value="24">整行</el-radio>
                  </el-radio-group>
                </div>
                <div class="form-block">
                  <span class="form-label">选项 options（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('options')" @update:model-value="setJsonProp('options', $event)" placeholder='[{"label":"正常","value":"active"}]' />
                </div>
                <div class="form-block">
                  <span class="form-label">字典编码</span>
                  <el-input :model-value="String(selectedProps.dict ?? '')" @update:model-value="setProp('dict', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">树接口</span>
                  <el-input :model-value="String(selectedProps.treeEndpoint ?? '')" @update:model-value="setProp('treeEndpoint', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">校验规则（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('rules')" @update:model-value="setJsonProp('rules', $event)" />
                </div>
              </template>

              <!-- 查询 -->
              <template v-if="selected.role === 'query'">
                <div class="form-block">
                  <span class="form-label">控件</span>
                  <el-select :model-value="selectedProps.control ?? 'input'" @update:model-value="setProp('control', $event)">
                    <el-option label="输入框" value="input" /><el-option label="下拉" value="select" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">匹配方式</span>
                  <el-select :model-value="selectedProps.match ?? ''" @update:model-value="setProp('match', $event)" clearable placeholder="按控件推断">
                    <el-option label="精确 eq" value="eq" /><el-option label="模糊 like" value="like" /><el-option label="集合 in" value="in" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">参与模糊匹配的字段</span>
                  <el-input
                    :model-value="(selectedProps.props ?? []).join(',')"
                    @update:model-value="setProp('props', $event ? $event.split(',').map((item: string) => item.trim()).filter(Boolean) : null)"
                    placeholder="username,nickname"
                  />
                </div>
                <div class="form-block">
                  <span class="form-label">占位提示</span>
                  <el-input :model-value="String(selectedProps.placeholder ?? '')" @update:model-value="setProp('placeholder', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">选项 options（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('options')" @update:model-value="setJsonProp('options', $event)" />
                </div>
              </template>

              <!-- 动作 -->
              <template v-if="selected.role === 'action'">
                <div class="form-block">
                  <span class="form-label">动作类型</span>
                  <el-select :model-value="selectedProps.kind ?? 'request'" @update:model-value="setProp('kind', $event)">
                    <el-option v-for="kind in ['create','edit','delete','toggle','detail','request']" :key="kind" :label="kind" :value="kind" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">样式</span>
                  <el-select :model-value="selectedProps.variant ?? 'default'" @update:model-value="setProp('variant', $event)">
                    <el-option v-for="variant in ['default','primary','success','warning','danger']" :key="variant" :label="variant" :value="variant" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">权限码</span>
                  <el-input :model-value="String(selectedProps.permission ?? '')" @update:model-value="setProp('permission', $event)" placeholder="system:user:add" />
                </div>
                <div class="form-block">
                  <span class="form-label">请求模板 request（JSON）</span>
                  <el-input type="textarea" :rows="3" :model-value="jsonPropOf('request')" @update:model-value="setJsonProp('request', $event)" placeholder='{"method":"DELETE","path":"/system/users/{id}"}' />
                </div>
                <div class="form-block">
                  <span class="form-label">二次确认文案</span>
                  <el-input :model-value="String(selectedProps.confirm ?? '')" @update:model-value="setProp('confirm', $event)" placeholder="确定删除「{nickname}」？" />
                </div>
                <div class="form-block">
                  <span class="form-label">行级禁用条件（JSON）</span>
                  <el-input type="textarea" :rows="2" :model-value="jsonPropOf('disabledWhen')" @update:model-value="setJsonProp('disabledWhen', $event)" />
                </div>
                <div class="form-block">
                  <span class="form-label">行级可见条件（JSON）</span>
                  <el-input type="textarea" :rows="2" :model-value="jsonPropOf('visibleWhen')" @update:model-value="setJsonProp('visibleWhen', $event)" />
                </div>
              </template>

              <!-- 容器 -->
              <template v-if="selectedSpec?.layer === 'container'">
                <div v-if="selectedSpec.editable.includes('endpoint')" class="form-block">
                  <span class="form-label">接口 endpoint</span>
                  <el-input :model-value="String(selectedProps.endpoint ?? '')" @update:model-value="setProp('endpoint', $event)" />
                </div>
                <div v-if="selectedSpec.editable.includes('pageSize')" class="form-block">
                  <span class="form-label">每页条数</span>
                  <el-input-number :model-value="Number(selectedProps.pageSize ?? 10)" @update:model-value="setProp('pageSize', Number($event))" :min="5" :max="200" />
                </div>
                <div v-if="selectedSpec.editable.includes('layout')" class="form-block">
                  <span class="form-label">页面形态</span>
                  <el-select :model-value="selectedProps.layout ?? 'table'" @update:model-value="setProp('layout', $event)">
                    <el-option label="查询 + 表格" value="table" /><el-option label="树形表格" value="tree-table" />
                  </el-select>
                </div>
                <div v-if="selectedSpec.editable.includes('treeEndpointOf')" class="form-block">
                  <span class="form-label">树接口</span>
                  <el-input :model-value="String(selectedProps.treeEndpointOf ?? '')" @update:model-value="setProp('treeEndpointOf', $event)" />
                </div>
                <div v-if="selectedSpec.editable.includes('treeParam')" class="form-block">
                  <span class="form-label">查询参数名</span>
                  <el-input :model-value="String(selectedProps.treeParam ?? '')" @update:model-value="setProp('treeParam', $event)" />
                </div>
              </template>

              <el-divider />
              <div class="inspector-actions">
                <el-button size="small" @click="toggleLock">{{ selected.locked ? '解锁' : '锁定' }}</el-button>
                <el-button size="small" @click="duplicateSelected">复制</el-button>
                <el-button size="small" type="danger" @click="removeSelected">删除</el-button>
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane :label="`数据与事件${selected?.bindings.length ? ' · ' + selected.bindings.length : ''}`" name="bindings">
            <template v-if="!selected">
              <p class="muted empty-hint">选中元素后可挂数据通道与事件通道。</p>
            </template>
            <template v-else>
              <div class="form-block">
                <span class="form-label">可用通道</span>
                <div class="channel-list">
                  <el-button
                    v-for="channel in selectedChannels"
                    :key="channel.channel"
                    size="small"
                    :icon="channel.kind === 'data' ? Link : Promotion"
                    @click="addBinding(channel.kind, channel.channel)"
                  >
                    {{ channel.label }}（{{ channel.channel }}）
                  </el-button>
                </div>
              </div>
              <div v-for="(binding, index) in selected.bindings" :key="index" class="binding-card">
                <div class="binding-card__head">
                  <el-tag size="small" :type="binding.kind === 'data' ? 'success' : 'warning'">
                    {{ binding.kind === 'data' ? '数据' : '事件' }}
                  </el-tag>
                  <code>{{ binding.channel }}</code>
                  <el-button text size="small" type="danger" :icon="Delete" @click="removeBinding(index)" />
                </div>
                <div v-if="binding.kind === 'data'" class="form-block">
                  <span class="form-label">数据源</span>
                  <el-input :model-value="binding.source ?? ''" @update:model-value="setBindingField(index, 'source', $event)" placeholder="行字段名 / 上下文键" />
                </div>
                <template v-else>
                  <div class="form-block">
                    <span class="form-label">动作</span>
                    <el-select :model-value="binding.action ?? 'reload'" @update:model-value="setBindingField(index, 'action', $event)">
                      <el-option v-for="action in ['navigate','request','reload','dialog','emit']" :key="action" :label="action" :value="action" />
                    </el-select>
                  </div>
                  <div class="form-block">
                    <span class="form-label">参数 params（JSON）</span>
                    <el-input
                      type="textarea" :rows="3"
                      :model-value="binding.params ? JSON.stringify(binding.params, null, 2) : ''"
                      @update:model-value="setBindingParams(index, $event)"
                      placeholder='{"method":"POST","path":"/system/users"}' 
                    />
                  </div>
                </template>
              </div>
              <p v-if="selectedIssues.length" class="issue-list">
                <span v-for="(issue, index) in selectedIssues" :key="index">· {{ issue }}</span>
              </p>
            </template>
          </el-tab-pane>

          <el-tab-pane label="vibeelement" name="vibe">
            <template v-if="!selected">
              <p class="muted empty-hint">选中元素后可以写模板片段，改一个字即时预览。</p>
            </template>
            <template v-else>
              <div class="form-block">
                <span class="form-label">
                  模板片段
                  <el-button text size="small" @click="ensureCode">填入默认模板</el-button>
                </span>
                <el-input
                  type="textarea" :rows="6" resize="vertical"
                  :model-value="String(selectedProps.code ?? '')"
                  @update:model-value="setProp('code', $event)"
                  placeholder='<el-button type="primary" @click="onClick">{{ label }}</el-button>'
                />
                <span class="muted hint">
                  只允许插值与已注册组件；禁 &lt;script&gt; / v-html / 内联表达式 —— 模板会随图纸下发，必须可安全执行。
                </span>
              </div>
              <div class="form-block">
                <span class="form-label">实时预览</span>
                <div class="vibe-preview">
                  <VibeElement
                    v-if="vibePreview && selected"
                    :element="selected"
                    :model="vibePreview"
                    :handlers="vibeHandlers"
                    :context="{ label: String(selectedProps.label ?? selected.text ?? '按钮'), value: selectedProps.value ?? '', text: String(selectedProps.label ?? selected.text ?? '示例文本'), series: [] }"
                  />
                  <span v-else class="muted">暂无预览</span>
                </div>
              </div>
              <p v-if="selectedIssues.length" class="issue-list">
                <span v-for="(issue, index) in selectedIssues" :key="index">· {{ issue }}</span>
              </p>
            </template>
          </el-tab-pane>

          <el-tab-pane :label="`编译${diagnostics.length ? ' · ' + diagnostics.length : ''}`" name="compile">
            <div v-if="compileResult" class="compile-summary">
              <div><span>页面 key</span><strong>{{ compileResult.key }}</strong></div>
              <div><span>列</span><strong>{{ compileResult.analysis.columns.length }}</strong></div>
              <div><span>字段</span><strong>{{ compileResult.analysis.fields.length }}</strong></div>
              <div><span>查询</span><strong>{{ compileResult.analysis.queries.length }}</strong></div>
              <div><span>动作</span><strong>{{ compileResult.analysis.actions.length }}</strong></div>
              <div><span>左树</span><strong>{{ compileResult.analysis.hasTree ? '有' : '无' }}</strong></div>
              <div><span>AI</span><strong>{{ compileResult.ai.enabled ? compileResult.ai.model : '未启用' }}</strong></div>
            </div>
            <div v-if="diagnostics.length" class="diagnostic-list">
              <div v-for="(item, index) in diagnostics" :key="index" class="diagnostic" :class="`is-${item.level}`">
                <el-tag size="small" :type="item.level === 'error' ? 'danger' : item.level === 'warn' ? 'warning' : 'info'">{{ item.level }}</el-tag>
                <span>{{ item.message }}</span>
              </div>
            </div>
            <p v-else class="muted">没有诊断，可以发布。</p>
            <template v-if="questions.length">
              <el-divider />
              <div class="form-block">
                <span class="form-label">会问模型的字段</span>
                <div class="question-list">
                  <div v-for="question in questions" :key="question.id" class="question">
                    <code>{{ question.elementId ?? 'meta' }}</code>
                    <span>{{ question.prompt }}</span>
                  </div>
                </div>
              </div>
            </template>
            <el-divider />
            <div class="form-block">
              <span class="form-label">编译出的 schema（即将发布的内容）</span>
              <el-input type="textarea" :rows="14" :model-value="JSON.stringify(compileResult?.schema ?? {}, null, 2)" readonly />
            </div>
          </el-tab-pane>
        </el-tabs>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ui-designer { min-width: 0; }
.designer-layout {
  display: grid; grid-template-columns: 300px minmax(0, 1fr) 380px;
  gap: 16px; align-items: start; min-width: 0;
}
.designer-layout > * { min-width: 0; }
.designer-menu { display: grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 0; overflow: hidden; }
.menu-column { padding: 12px; min-width: 0; }
.menu-column--tree { border-left: 1px solid var(--line); display: flex; flex-direction: column; }
.menu-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--muted); margin-bottom: 10px;
}
.role-groups { display: flex; flex-direction: column; gap: 12px; }
.role-group { display: flex; flex-direction: column; gap: 4px; }
.role-group__label { font-size: 11px; color: var(--muted); }
.role-chip {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 8px; border-radius: 6px; border: 1px solid var(--line);
  background: var(--surface); color: var(--app-text); font-size: 12px; cursor: pointer; text-align: left;
}
.role-chip:hover:not(:disabled) { border-color: rgba(99, 102, 241, .6); }
.role-chip:disabled { opacity: .45; cursor: not-allowed; }
.role-chip__dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
.tree-scroll { max-height: 560px; }
.tree-group { margin-bottom: 10px; }
.tree-group__label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.tree-row {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 4px 6px; border-radius: 6px; border: 1px solid transparent;
  background: transparent; color: var(--app-text); font-size: 12px; cursor: pointer; text-align: left;
}
.tree-row:hover { background: rgba(99, 102, 241, .08); }
.tree-row.is-active { border-color: rgba(99, 102, 241, .5); background: rgba(99, 102, 241, .12); }
.tree-row__dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
.tree-row__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-row__role { color: var(--muted); font-size: 11px; flex: 0 0 auto; }
.designer-canvas { display: flex; flex-direction: column; padding: 12px; gap: 10px; }
.canvas-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.canvas-scroll { max-height: 720px; background: #eef2f7; border-radius: 8px; padding: 12px; }
.designer-inspector { padding: 0 12px 12px; }
.inspector-tabs :deep(.el-tabs__header) { margin-bottom: 10px; }
.inspector-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.inspector-desc { font-size: 12px; margin: 0 0 10px; }
.form-block { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.form-label { font-size: 12px; color: var(--muted); display: flex; align-items: center; justify-content: space-between; }
.hint { font-size: 11px; line-height: 1.5; }
.empty-hint { font-size: 12px; }
.inspector-actions { display: flex; gap: 8px; }
.channel-list { display: flex; flex-wrap: wrap; gap: 6px; }
.channel-list :deep(.el-button) { margin: 0; }
.binding-card { border: 1px solid var(--line); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.binding-card__head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.binding-card__head code { flex: 1 1 auto; font-size: 11px; }
.issue-list { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #b45309; margin: 0; }
.vibe-preview {
  border: 1px dashed var(--line); border-radius: 6px; padding: 10px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
}
.compile-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.compile-summary div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.compile-summary span { color: var(--muted); }
.diagnostic-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.diagnostic { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; }
.question-list { display: flex; flex-direction: column; gap: 6px; }
.question { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.question code { font-size: 11px; color: var(--muted); }
@media (max-width: 1600px) { .designer-layout { grid-template-columns: 260px minmax(0, 1fr) 340px; } }
@media (max-width: 1280px) { .designer-layout { grid-template-columns: minmax(0, 1fr); } }
</style>
