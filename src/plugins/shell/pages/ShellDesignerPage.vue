<script setup lang="ts">
// 外壳设计器：IDE / CAD 式布局——一条工具条 + 画布吃掉剩余空间。
//
// 任务目标落在三处：
// 1. 画布画外壳：每个图标/品牌/菜单/用户区都是一等元素，拖动即改运行期排布；
// 2. 图标点击事件可配：点选图标 → 「点击事件」页签 → 动作（跳转/请求/命令/派发/弹窗）与其参数；
// 3. 在线写代码：任何元素都能写一段模板（vibeelement），在画布上即时看到效果，零代码零发版。
//
// 状态机在 `designer.ts`，这里只管排版与交互入口。
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, Delete, DocumentAdd, FullScreen, MagicStick, MoreFilled, Promotion,
  Setting, SortUp, Stamp, View, ZoomIn, ZoomOut,
} from '@element-plus/icons-vue'
import { SHELL_ROLE_LIST, shellItemOf } from '@/shared/shell'
import { designContext } from '@/components/shell/context'
import ShellDrawingCanvas from '@/components/shell/ShellDrawingCanvas.vue'
import ShellFrame from '@/components/shell/ShellFrame.vue'
import { SHELL_ACTIONS, actionParamsTemplate, useShellDesigner } from '../designer'
import ShellElementView from '@/components/shell/ShellElementView.vue'

// 动作标签/说明：模板里要用，且必须与编译器校验的语义一致，所以做成常量。
const ACTION_LABEL: Record<string, string> = {
  navigate: '跳转到页面',
  request: '调用接口',
  command: '执行内核命令',
  emit: '派发事件',
  dialog: '弹出提示',
  none: '无动作',
}
const ACTION_HINT: Record<string, string> = {
  navigate: '参数 path（必填）、可选 query',
  request: '参数 method / path（必填）/ body',
  command: '参数 name（必填，如 kernel.reload-plugins）、args',
  emit: '参数 event（必填）、可选 payload',
  dialog: '参数 title / message',
  none: '点了不会有反应，建议至少配一个动作',
}

/** 结构树里显示角色中文名（避免在模板里再维护一张表）。 */
function shellSpecLabel(role: string): string {
  return SHELL_ROLE_LIST.find((spec) => spec.role === role)?.label ?? role
}

const route = useRoute()
const router = useRouter()
const designer = useShellDesigner(() => Number(route.query.id ?? 0))

const {
  drawing, name, savedVersion, selectedIds, zoom, snap, showRegions,
  loading, saving, publishing, dirty, railOpen, railTab, inspectorOpen, inspectorTab,
  compileResult, selected, selectedSpec, selectedProps, canEdit, diagnostics, errors, analysis, elementTree, viewport,
  load, dispose, onRect, addRole, removeSelected, duplicateSelected, toggleVisible,
  setProp, setMeta,
  clickBinding, setAction, setActionParams, setConfirm, actionParamsText, clearClickBinding,
  codeIssues, ensureCode,
  openInspector, openShellSettings, inspectorTitle, openElement,
  zoomIn, zoomOut, zoomFit, save, publish, unpublish, markDirty, applyZoom,
} = designer

const ctx = designContext()

/** 画布上点条目只选中，不真跳转（设计器不离开本页）。 */
function onCanvasActivate(element: { id: string }): void {
  selectedIds.value = [element.id]
}

/** Ctrl/⌘ + 滚轮缩放；普通滚轮照常滚动。 */
function onWheel(event: WheelEvent): void {
  applyZoom(zoom.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
}

/**
 * 画布滚动宿主：模板 ref 落到设计器的 `viewport` 上，缩放/适配以它为锚点
 * （`applyZoom` / `zoomFit` 内部读同一个 ref）。
 */
function setViewport(el: Element | { $el?: Element } | null): void {
  if (el instanceof HTMLElement) { viewport.value = el; return }
  const inner = el && '$el' in el ? el.$el : null
  viewport.value = inner instanceof HTMLElement ? inner : null
}

onMounted(load)
onBeforeUnmount(dispose)
</script>

<template>
  <div class="sh-designer" v-loading="loading">
    <!-- ① 工具条 -->
    <div class="sh-bar">
      <el-tooltip content="返回外壳库" placement="bottom" :show-after="400">
        <button class="sh-icon" type="button" @click="router.push({ name: 'shell-gallery' })">
          <el-icon :size="15"><ArrowLeft /></el-icon>
        </button>
      </el-tooltip>
      <div class="sh-title" :title="name || '未命名外壳'">
        <strong>{{ name || '未命名外壳' }}</strong>
        <span class="sh-title__meta">
          <em :class="{ 'is-dirty': dirty }">{{ dirty ? '未保存' : `v${savedVersion}` }}</em>
          <em v-if="errors.length" class="is-error">{{ errors.length }} 处错误</em>
        </span>
      </div>

      <span class="sh-divider" />

      <el-tooltip content="运行预览：按当前图纸现编译的外壳渲染（未落库）" placement="bottom" :show-after="400">
        <button class="sh-icon" type="button" @click="openInspector('compile')">
          <el-icon :size="15"><View /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="外壳设置：key / 标题 / 说明" placement="bottom" :show-after="400">
        <button class="sh-icon" type="button" @click="openShellSettings">
          <el-icon :size="15"><Setting /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="编译检查与诊断" placement="bottom" :show-after="400">
        <button class="sh-icon" type="button" @click="openInspector('compile')">
          <el-icon :size="15"><Stamp /></el-icon>
          <span v-if="diagnostics.length" class="sh-badge" :class="{ 'is-danger': errors.length }">{{ diagnostics.length }}</span>
        </button>
      </el-tooltip>

      <span class="sh-grow" />

      <div class="sh-zoom">
        <button class="sh-icon sh-icon--sm" type="button" title="缩小（Ctrl/⌘ + 滚轮）" @click="zoomOut">
          <el-icon :size="13"><ZoomOut /></el-icon>
        </button>
        <button class="sh-zoom__value" type="button" title="适配窗口" @click="zoomFit">{{ Math.round(zoom * 100) }}%</button>
        <button class="sh-icon sh-icon--sm" type="button" title="放大（Ctrl/⌘ + 滚轮）" @click="zoomIn">
          <el-icon :size="13"><ZoomIn /></el-icon>
        </button>
      </div>
      <el-tooltip content="画布铺满视口（隐藏左栏）" placement="bottom" :show-after="400">
        <button class="sh-icon" type="button" :class="{ 'is-on': !railOpen }" @click="railOpen = !railOpen">
          <el-icon :size="15"><FullScreen /></el-icon>
        </button>
      </el-tooltip>

      <span class="sh-divider" />

      <button class="sh-btn" type="button" :disabled="saving" @click="save">保存</button>
      <button class="sh-btn sh-btn--primary" type="button" :disabled="publishing" @click="publish">发布</button>
      <el-dropdown v-if="analysis" trigger="click" @command="(c: string) => c === 'unpublish' && unpublish()">
        <button class="sh-icon" type="button" title="更多（下线外壳）"><el-icon :size="15"><MoreFilled /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="unpublish" :icon="Delete">下线外壳</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- ② 画布区 -->
    <div class="sh-body">
      <aside v-show="railOpen" class="sh-rail">
        <div class="sh-rail__tabs">
          <button class="sh-rail__tab" type="button" :class="{ 'is-active': railTab === 'palette' }"
            title="元素库：点一下加到画布，或拖到指定位置" @click="railTab = 'palette'">
            <el-icon :size="14"><DocumentAdd /></el-icon>
          </button>
          <button class="sh-rail__tab" type="button" :class="{ 'is-active': railTab === 'tree' }"
            :title="`结构树（${drawing.elements.length} 元素）`" @click="railTab = 'tree'">
            <el-icon :size="14"><SortUp /></el-icon>
          </button>
        </div>

        <div v-show="railTab === 'palette'" class="sh-rail__body">
          <div v-for="layer in ['region', 'element', 'band'] as const" :key="layer" class="sh-group">
            <p class="sh-group__label">{{ layer === 'region' ? '区域' : layer === 'element' ? '元素' : '装饰' }}</p>
            <button
              v-for="spec in SHELL_ROLE_LIST.filter((item) => item.layer === layer)"
              :key="spec.role"
              class="sh-role"
              type="button"
              :title="`${spec.label}：${spec.description}`"
              draggable="true"
              @click="addRole(spec.role, { x: 60, y: 200 + drawing.elements.length * 8 })"
              @dragstart="($event.dataTransfer?.setData('application/x-shell-role', spec.role))"
            >
              <span class="sh-role__dot" :style="{ background: spec.tint }" />
              <span class="sh-role__text">{{ spec.label }}</span>
            </button>
          </div>
        </div>

        <div v-show="railTab === 'tree'" class="sh-rail__body">
          <div v-for="group in elementTree" :key="group.label" class="sh-group">
            <p class="sh-group__label">{{ group.label }}</p>
            <button
              v-for="element in group.elements"
              :key="element.id"
              type="button"
              class="sh-node"
              :class="{ 'is-active': selectedIds.includes(element.id) }"
              :title="`${element.id} · 双击打开属性`"
              @click="selectedIds = [element.id]"
              @dblclick="openElement(element.id)"
            >
              <span class="sh-role__dot" :style="{ background: SHELL_ROLE_LIST.find((s) => s.role === element.role)?.tint }" />
              <span class="sh-node__text">{{ element.text || element.id }}</span>
              <span class="sh-node__role">{{ shellSpecLabel(element.role) }}</span>
            </button>
          </div>
          <p v-if="!drawing.elements.length" class="sh-empty">从元素库点一个开始画。</p>
        </div>
      </aside>

      <div
        :ref="setViewport"
        class="sh-viewport"
        @wheel.ctrl.prevent="onWheel"
        @wheel.meta.prevent="onWheel"
      >
        <div class="sh-canvas">
          <ShellDrawingCanvas
            :drawing="drawing"
            :selected-ids="selectedIds"
            :zoom="zoom"
            :snap="snap"
            :show-regions="showRegions"
            :ctx="ctx"
            @update:selected-ids="selectedIds = $event"
            @update="onRect"
            @drop-role="addRole"
            @open="openElement"
            @activate="onCanvasActivate"
          />
        </div>
      </div>
    </div>

    <!-- ③ 状态条 -->
    <div class="sh-status">
      <button class="sh-status__btn" type="button" :class="{ 'is-on': snap }" @click="snap = !snap">吸附 {{ snap ? '开' : '关' }}</button>
      <button class="sh-status__btn" type="button" :class="{ 'is-on': showRegions }" @click="showRegions = !showRegions">区域线</button>
      <span class="sh-status__sep" />
      <span>{{ drawing.elements.length }} 元素</span>
      <span v-if="selectedIds.length">{{ selectedIds.length }} 选中</span>
      <span class="sh-status__grow" />
      <span v-if="selected">{{ selectedSpec?.label }} · {{ selected.id }}</span>
      <span class="sh-status__sep" />
      <span>{{ drawing.canvas.width }} × {{ drawing.canvas.height }}</span>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <span class="sh-status__hint">拖图标改顶栏排布 · 双击元素改属性 · Ctrl+滚轮缩放</span>
    </div>

    <!-- ④ 选中浮条 -->
    <transition name="sh-rise">
      <div v-if="selectedIds.length" class="sh-floating">
        <span class="sh-floating__name">{{ selected ? (selectedSpec?.label + ' · ' + selected.id) : `${selectedIds.length} 个元素` }}</span>
        <span class="sh-divider" />
        <button class="sh-icon sh-icon--sm" type="button" title="复制" :disabled="!selected" @click="duplicateSelected">
          <el-icon :size="13"><DocumentAdd /></el-icon>
        </button>
        <button class="sh-icon sh-icon--sm" type="button" title="显示/隐藏" :disabled="!selected" @click="toggleVisible">
          <el-icon :size="13"><MagicStick /></el-icon>
        </button>
        <button class="sh-icon sh-icon--sm is-danger" type="button" title="删除" @click="removeSelected">
          <el-icon :size="13"><Delete /></el-icon>
        </button>
        <span class="sh-divider" />
        <button class="sh-btn sh-btn--px" type="button" @click="openInspector('props')">属性</button>
        <button class="sh-btn sh-btn--px" type="button" @click="openInspector('events')">点击事件</button>
        <button class="sh-btn sh-btn--px" type="button" @click="openInspector('vibe')">模板</button>
      </div>
    </transition>

    <!-- ⑤ 检查器 -->
    <el-dialog v-model="inspectorOpen" :title="inspectorTitle" width="min(880px, 92vw)" top="6vh" append-to-body destroy-on-close class="sh-dialog">
      <div class="sh-inspector">
        <el-tabs v-model="inspectorTab">
          <!-- 属性 / 外壳设置 -->
          <el-tab-pane :label="selected ? '属性' : '外壳设置'" name="props">
            <template v-if="!selected">
              <p class="muted sh-hint">选中一个元素后在这里配置；多选时只显示数量（{{ selectedIds.length }}）。</p>
              <el-divider />
              <div class="sh-block">
                <span class="sh-label">外壳 key</span>
                <el-input :model-value="drawing.meta.key" @update:model-value="setMeta('key', $event)" placeholder="shell.default" />
              </div>
              <div class="sh-block">
                <span class="sh-label">标题</span>
                <el-input :model-value="drawing.meta.title" @update:model-value="setMeta('title', $event)" />
              </div>
              <div class="sh-block">
                <span class="sh-label">说明</span>
                <el-input type="textarea" :rows="2" :model-value="drawing.meta.description ?? ''" @update:model-value="setMeta('description', $event)" />
              </div>
            </template>

            <template v-else>
              <div class="sh-head">
                <el-tag size="small" effect="plain">{{ selectedSpec?.label }}</el-tag>
                <code>{{ selected.id }}</code>
              </div>
              <p class="muted sh-hint">{{ selectedSpec?.description }}</p>

              <div class="sh-block">
                <span class="sh-label">文案 text</span>
                <el-input :model-value="selected.text" @update:model-value="selected.text = $event; markDirty()" />
              </div>
              <div v-if="canEdit('label')" class="sh-block">
                <span class="sh-label">标签 label</span>
                <el-input :model-value="String(selectedProps.label ?? '')" @update:model-value="setProp('label', $event)" />
              </div>
              <div v-if="canEdit('icon')" class="sh-block">
                <span class="sh-label">图标 icon（Element Plus 图标名）</span>
                <el-input :model-value="String(selectedProps.icon ?? '')" @update:model-value="setProp('icon', $event)" placeholder="Bell / Sunny / Setting" />
              </div>
              <div v-if="canEdit('tooltip')" class="sh-block">
                <span class="sh-label">悬停提示</span>
                <el-input :model-value="String(selectedProps.tooltip ?? '')" @update:model-value="setProp('tooltip', $event)" />
              </div>
              <div v-if="canEdit('badge')" class="sh-block">
                <span class="sh-label">角标（`dot` 或数字）</span>
                <el-input :model-value="String(selectedProps.badge ?? '')" @update:model-value="setProp('badge', $event)" placeholder="dot / 5" />
              </div>
              <div v-if="canEdit('variant')" class="sh-block">
                <span class="sh-label">强调色</span>
                <el-select :model-value="selectedProps.variant ?? 'default'" @update:model-value="setProp('variant', $event)">
                  <el-option v-for="v in ['default','primary','success','warning','danger']" :key="v" :label="v" :value="v" />
                </el-select>
              </div>
              <div v-if="canEdit('permission')" class="sh-block">
                <span class="sh-label">权限码（无权限不渲染）</span>
                <el-input :model-value="String(selectedProps.permission ?? '')" @update:model-value="setProp('permission', $event)" placeholder="system:user:list" />
              </div>
              <div v-if="canEdit('align')" class="sh-block">
                <span class="sh-label">顶栏靠向</span>
                <el-select :model-value="selectedProps.align ?? 'auto'" @update:model-value="setProp('align', $event === 'auto' ? null : $event)" clearable>
                  <el-option label="按位置自动" value="auto" /><el-option label="靠左" value="left" /><el-option label="靠右" value="right" />
                </el-select>
              </div>
              <div v-if="canEdit('showLabel')" class="sh-block">
                <span class="sh-label">显示文案</span>
                <el-switch :model-value="selectedProps.showLabel !== false" @update:model-value="setProp('showLabel', $event)" />
              </div>
              <template v-if="selected.role === 'brand'">
                <div class="sh-block">
                  <span class="sh-label">Logo 短字</span>
                  <el-input :model-value="String(selectedProps.logoText ?? '')" @update:model-value="setProp('logoText', $event)" />
                </div>
                <div class="sh-block">
                  <span class="sh-label">主标题</span>
                  <el-input :model-value="String(selectedProps.brandTitle ?? '')" @update:model-value="setProp('brandTitle', $event)" />
                </div>
                <div class="sh-block">
                  <span class="sh-label">副标题</span>
                  <el-input :model-value="String(selectedProps.brandSubtitle ?? '')" @update:model-value="setProp('brandSubtitle', $event)" />
                </div>
              </template>
              <template v-if="selected.role === 'sidebar'">
                <div class="sh-block"><span class="sh-label">侧栏宽度</span>
                  <el-input-number :model-value="Number(selectedProps.width ?? 248)" @update:model-value="setProp('width', Number($event))" :min="120" :max="420" /></div>
                <div class="sh-block"><span class="sh-label">收起宽度</span>
                  <el-input-number :model-value="Number(selectedProps.collapsedWidth ?? 76)" @update:model-value="setProp('collapsedWidth', Number($event))" :min="48" :max="160" /></div>
                <div class="sh-block"><span class="sh-label">底色</span>
                  <el-input :model-value="String(selectedProps.bg ?? '')" @update:model-value="setProp('bg', $event)" placeholder="#0f172a" /></div>
                <div class="sh-block"><span class="sh-label">文字色</span>
                  <el-input :model-value="String(selectedProps.textColor ?? '')" @update:model-value="setProp('textColor', $event)" placeholder="#cbd5e1" /></div>
              </template>
              <template v-if="selected.role === 'topbar'">
                <div class="sh-block"><span class="sh-label">顶栏高度</span>
                  <el-input-number :model-value="Number(selectedProps.height ?? 76)" @update:model-value="setProp('height', Number($event))" :min="44" :max="140" /></div>
              </template>
              <el-divider />
              <div class="sh-actions">
                <el-button size="small" @click="duplicateSelected">复制</el-button>
                <el-button size="small" @click="toggleVisible">{{ selected.visible === false ? '显示' : '隐藏' }}</el-button>
                <el-button size="small" type="danger" @click="removeSelected">删除</el-button>
              </div>
            </template>
          </el-tab-pane>

          <!-- 点击事件：本任务核心，图标的点击都能在这里配出来 -->
          <el-tab-pane label="点击事件" name="events">
            <template v-if="!selected">
              <p class="muted sh-hint">选中一个图标/按钮/用户区后，在这里配它的点击动作。</p>
            </template>
            <template v-else>
              <div class="sh-block">
                <span class="sh-label">事件通道</span>
                <el-tag size="small" type="warning">click（点击）</el-tag>
                <span class="muted sh-hint">外壳元素只有点击一个通道。</span>
              </div>
              <div class="sh-block">
                <span class="sh-label">动作 action</span>
                <el-select :model-value="clickBinding?.action ?? 'none'" @update:model-value="setAction($event)">
                  <el-option v-for="action in SHELL_ACTIONS" :key="action" :label="ACTION_LABEL[action]" :value="action" />
                </el-select>
                <span class="muted sh-hint">{{ ACTION_HINT[clickBinding?.action ?? 'none'] }}</span>
              </div>
              <div v-if="clickBinding && clickBinding.action && clickBinding.action !== 'none'" class="sh-block">
                <span class="sh-label">
                  参数 params（JSON）
                  <el-button text size="small" @click="setActionParams(actionParamsTemplate(clickBinding.action))">填入模板</el-button>
                </span>
                <el-input type="textarea" :rows="5" :model-value="actionParamsText()" @update:model-value="setActionParams($event)" />
              </div>
              <div v-if="clickBinding && clickBinding.action && clickBinding.action !== 'none'" class="sh-block">
                <span class="sh-label">二次确认文案（留空则不弹）</span>
                <el-input :model-value="String(clickBinding.confirm ?? '')" @update:model-value="setConfirm($event)" />
              </div>
              <el-divider />
              <div class="sh-actions">
                <el-button size="small" @click="setAction('navigate')">快速设为跳转</el-button>
                <el-button size="small" @click="setAction('dialog')">快速设为弹窗</el-button>
                <el-button size="small" type="danger" @click="clearClickBinding">清除点击事件</el-button>
              </div>
              <p v-if="clickBinding" class="sh-preview">
                运行期效果：点击后<strong>{{ ACTION_LABEL[clickBinding.action ?? 'none'] }}</strong>
                <code v-if="clickBinding.params">{{ JSON.stringify(clickBinding.params) }}</code>
              </p>
            </template>
          </el-tab-pane>

          <!-- 在线写代码 -->
          <el-tab-pane label="模板" name="vibe">
            <template v-if="!selected">
              <p class="muted sh-hint">选中元素后可以写模板片段，改一个字即时预览。</p>
            </template>
            <template v-else>
              <div class="sh-block">
                <span class="sh-label">
                  模板片段
                  <el-button text size="small" @click="ensureCode">填入默认模板</el-button>
                </span>
                <el-input
                  type="textarea" :rows="7" resize="vertical"
                  :model-value="String(selectedProps.code ?? '')"
                  @update:model-value="setProp('code', $event)"
                  placeholder='<el-icon :size="17"><component :is="icon" /></el-icon>'
                />
                <span class="muted sh-hint">
                  只允许插值与已注册组件；禁 &lt;script&gt; / v-html / 内联表达式 —— 模板会随外壳下发，必须可安全执行。
                  可用的名字：<code>label</code> / <code>icon</code> / <code>text</code> / <code>path</code> / <code>title</code> / <code>user</code>，事件方法 <code>onClick</code>。
                </span>
              </div>
              <div v-if="codeIssues.length" class="sh-issues">
                <span v-for="(issue, index) in codeIssues" :key="index">· {{ issue.message }}</span>
              </div>
              <div class="sh-block">
                <span class="sh-label">实时预览</span>
                <div class="sh-preview sh-preview--vibe">
                  <ShellElementView
                    :item="shellItemOf(selected)"
                    :ctx="ctx"
                  />
                </div>
              </div>
            </template>
          </el-tab-pane>

          <!-- 编译结果 -->
          <el-tab-pane label="编译与预览" name="compile">
            <div class="sh-block">
              <span class="sh-label">
                运行预览
                <el-tag size="small" type="info">本地现编译，未落库</el-tag>
              </span>
              <div class="sh-preview sh-preview--frame">
                <ShellFrame v-if="analysis" class="sh-frame-preview" :override="compileResult?.schema" />
              </div>
            </div>
            <div v-if="analysis" class="sh-summary">
              <div><span>外壳 key</span><strong>{{ compileResult?.key }}</strong></div>
              <div><span>顶栏左/右</span><strong>{{ analysis.icons.length }} 图标 · {{ compileResult?.schema.topbar.left.length }} / {{ compileResult?.schema.topbar.right.length }}</strong></div>
              <div><span>在线模板元素</span><strong>{{ analysis.vibes.length }}</strong></div>
              <div><span>待扩展元素</span><strong>{{ analysis.unsupported.length }}</strong></div>
            </div>
            <el-divider />
            <p class="muted sh-hint">按当前图纸现编译的外壳渲染在下方（与上线后的外壳同一份渲染实现）。</p>
            <div v-if="!diagnostics.length" class="sh-ok">编译通过，没有诊断。</div>
            <div v-else class="sh-diags">
              <div v-for="(item, index) in diagnostics" :key="index" class="sh-diag" :class="`is-${item.level}`">
                <el-icon v-if="item.level === 'error'"><Delete /></el-icon>
                <el-icon v-else><Promotion /></el-icon>
                <span>{{ item.message }}</span>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.sh-designer {
  --sh-bar-h: 40px;
  --sh-status-h: 24px;
  display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--app-bg);
  container-type: inline-size; container-name: shell;
}

/* ① 工具条 */
.sh-bar {
  flex: 0 0 var(--sh-bar-h); height: var(--sh-bar-h); display: flex; align-items: center; gap: 3px;
  padding: 0 8px; background: var(--surface); border-bottom: 1px solid var(--line); position: relative; z-index: 6;
}
.sh-icon {
  position: relative; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid transparent;
  border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer;
}
.sh-icon:hover { background: var(--hover); color: var(--app-text); }
.sh-icon.is-on { border-color: rgba(99, 102, 241, .4); color: #4f46e5; background: rgba(99, 102, 241, .1); }
.sh-icon.is-danger { color: #dc2626; }
.sh-icon--sm { width: 22px; height: 22px; }
.sh-badge {
  position: absolute; top: -2px; right: -2px; min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 999px; background: #64748b; color: #fff; font-size: 9px; line-height: 13px; text-align: center;
}
.sh-badge.is-danger { background: #dc2626; }
.sh-title { display: flex; align-items: center; gap: 8px; padding: 0 8px; min-width: 0; max-width: 360px; }
.sh-title strong { font-size: 13px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-title__meta { display: flex; gap: 8px; font-style: normal; font-size: 11px; }
.sh-title__meta em { font-style: normal; color: var(--muted); }
.sh-title__meta em.is-dirty { color: #d97706; }
.sh-title__meta em.is-error { color: #dc2626; }
.sh-divider { width: 1px; height: 16px; margin: 0 4px; background: var(--line); flex: 0 0 auto; }
.sh-grow { flex: 1 1 auto; }
.sh-zoom { display: flex; align-items: center; gap: 1px; }
.sh-zoom__value {
  min-width: 44px; height: 22px; border: 1px solid transparent; border-radius: 5px; background: transparent;
  color: var(--muted); font-size: 11px; cursor: pointer;
}
.sh-zoom__value:hover { background: var(--hover); }
.sh-btn {
  height: 26px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface);
  color: var(--app-text); font-size: 12px; cursor: pointer;
}
.sh-btn:hover { border-color: var(--brand, #4f46e5); }
.sh-btn--primary { background: var(--brand, #4f46e5); border-color: var(--brand, #4f46e5); color: #fff; }
.sh-btn--px { height: 22px; padding: 0 8px; font-size: 11px; }
.sh-btn:disabled { opacity: .5; cursor: not-allowed; }

/* ② 左栏 + 画布 */
.sh-body { flex: 1 1 auto; min-height: 0; display: flex; }
.sh-rail {
  flex: 0 0 176px; width: 176px; min-height: 0; display: flex; flex-direction: column;
  background: var(--surface); border-right: 1px solid var(--line);
}
.sh-rail__tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); }
.sh-rail__tab {
  width: 28px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 5px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.sh-rail__tab.is-active { background: rgba(99, 102, 241, .14); color: #4f46e5; }
.sh-rail__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 8px 16px; }
.sh-group { margin-bottom: 12px; }
.sh-group__label { margin: 0 0 6px; padding: 0 4px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.sh-role, .sh-node {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 24px; padding: 0 6px; border: 0;
  border-radius: 4px; background: transparent; color: var(--app-text); font-size: 12px; text-align: left; cursor: pointer;
}
.sh-role:hover, .sh-node:hover { background: var(--hover); }
.sh-role__dot { width: 7px; height: 7px; border-radius: 2px; flex: 0 0 auto; }
.sh-role__text, .sh-node__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-node__role { color: var(--muted); font-size: 10px; flex: 0 0 auto; }
.sh-node.is-active { background: rgba(99, 102, 241, .14); color: #4f46e5; }
.sh-empty { margin: 8px 4px; font-size: 11px; color: var(--muted); }

.sh-viewport {
  flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; position: relative;
  background:
    linear-gradient(0deg, rgba(148, 163, 184, .1) 1px, transparent 1px) 0 0 / 100% 24px,
    var(--app-bg);
}
.sh-canvas { display: inline-block; padding: 16px; min-width: 100%; min-height: 100%; box-sizing: border-box; }

/* ③ 状态条 */
.sh-status {
  flex: 0 0 var(--sh-status-h); height: var(--sh-status-h); display: flex; align-items: center; gap: 10px;
  padding: 0 10px; background: var(--surface); border-top: 1px solid var(--line);
  font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden;
}
.sh-status__btn { height: 18px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.sh-status__btn:hover { background: var(--hover); }
.sh-status__btn.is-on { border-color: rgba(99, 102, 241, .4); color: #4f46e5; background: rgba(99, 102, 241, .1); }
.sh-status__sep { width: 1px; height: 12px; background: var(--line); }
.sh-status__grow { flex: 1 1 auto; }
.sh-status__hint { color: var(--muted); opacity: .8; }

/* ④ 选中浮条 */
.sh-floating {
  position: absolute; left: 50%; bottom: calc(var(--sh-status-h) + 14px); transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: var(--surface);
  border: 1px solid var(--line); border-radius: 7px; box-shadow: 0 6px 20px rgba(15, 23, 42, .14); z-index: 8;
}
.sh-floating__name { max-width: 200px; padding: 0 4px; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-rise-enter-active, .sh-rise-leave-active { transition: opacity .14s ease, transform .14s ease; }
.sh-rise-enter-from, .sh-rise-leave-to { opacity: 0; transform: translate(-50%, 6px); }

/* ⑤ 检查器 */
.sh-inspector { max-height: 74vh; overflow: auto; padding-right: 4px; }
.sh-block { display: flex; flex-direction: column; gap: 3px; margin-bottom: 9px; }
.sh-label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); }
.sh-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.sh-hint { font-size: 11px; line-height: 1.5; margin: 0; }
.sh-actions { display: flex; gap: 8px; }
.sh-issues { display: flex; flex-direction: column; gap: 2px; margin: 0 0 8px; font-size: 11px; color: #b45309; }
.sh-preview {
  margin: 8px 0; padding: 10px; border: 1px dashed var(--line); border-radius: 6px; font-size: 12px; color: var(--muted);
}
.sh-preview--vibe { display: flex; align-items: center; justify-content: center; min-height: 44px; }
.sh-preview--frame { padding: 0; border-style: solid; overflow: hidden; height: 320px; }
.sh-frame-preview { height: 100%; min-height: 0; }
.sh-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
.sh-summary div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.sh-summary span { color: var(--muted); }
.sh-ok { font-size: 12px; color: #15803d; }
.sh-diags { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.sh-diag { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; }
.sh-diag.is-error { color: #b91c1c; }
.sh-diag.is-warn { color: #b45309; }
.sh-preview code, .sh-hint code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

@container shell (max-width: 900px) {
  .sh-rail { flex-basis: 132px; width: 132px; }
  .sh-status__hint { display: none; }
}
</style>
