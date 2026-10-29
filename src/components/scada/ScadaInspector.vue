<!-- 组态属性面板：右侧属性页签。
     上面是图元自身的可编辑属性（由图元声明的 propSpec 决定控件形态），
     下面是图元的变量绑定槽位（valueText / fillRatio / stateColor / visibility / textMap / needle） -->
<script setup lang="ts">
import { computed } from 'vue'
import { Delete, Link, Position } from '@element-plus/icons-vue'
import type {
  ScadaBindingSlotSpec,
  ScadaDocument,
  ScadaPropSpec,
  ScadaStateThreshold,
  ScadaSymbolDefinition,
  ScadaTagOption,
  ScadaWidget,
  ScadaWidgetBinding,
} from '@/shared/scada/types'
import { describeBinding, effectiveProps, rotationDegrees } from '@/shared/scada/render'

const props = defineProps<{
  document: ScadaDocument
  widget: ScadaWidget | null
  symbol: ScadaSymbolDefinition | null
  tagById: Map<number, ScadaTagOption>
  selectedCount: number
  locked?: boolean
}>()

const emit = defineEmits<{
  (event: 'update-widget'): void
  (event: 'pick-tag', slotKey: string): void
  (event: 'clear-binding', slotKey: string): void
  (event: 'delete'): void
  (event: 'duplicate'): void
  (event: 'rotate'): void
  (event: 'toggle-lock'): void
  (event: 'update-canvas'): void
}>()

const resolvedProps = computed(() => {
  if (!props.widget || !props.symbol) return [] as Array<{ spec: ScadaPropSpec; value: unknown; group: string }>
  const effective = effectiveProps(props.widget, props.symbol)
  return props.symbol.props.map((spec) => ({
    spec,
    value: effective[spec.key],
    group: spec.group || '通用',
  }))
})

const propGroups = computed(() => {
  const groups = new Map<string, Array<{ spec: ScadaPropSpec; value: unknown }>>()
  for (const item of resolvedProps.value) {
    const list = groups.get(item.group) ?? []
    list.push({ spec: item.spec, value: item.value })
    groups.set(item.group, list)
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }))
})

const bindings = computed(() => {
  if (!props.widget || !props.symbol) return []
  return props.symbol.bindingSlots.map((slot) => {
    const binding = describeBinding(props.widget!, slot.key)
    const option = binding ? props.tagById.get(binding.tagId) : undefined
    return { slot, binding, option }
  })
})

const rotationLabel = computed(() => {
  const degrees = rotationDegrees(props.widget?.rotation)
  return degrees === 0 ? '0°' : `${degrees}°`
})

function setProp(spec: ScadaPropSpec, value: unknown) {
  if (!props.widget) return
  props.widget.props[spec.key] = value
  emit('update-widget')
}

function setBindingField(binding: ScadaWidgetBinding, field: 'precision' | 'unit', value: unknown) {
  if (field === 'precision') {
    const number = Number(value)
    binding.precision = Number.isFinite(number) && String(value).trim() !== '' ? Math.min(Math.max(number, 0), 6) : null
  } else {
    binding.unit = String(value ?? '').trim() || null
  }
  emit('update-widget')
}

function addThreshold(binding: ScadaWidgetBinding) {
  const list = binding.thresholds ?? (binding.thresholds = [])
  list.push({ limit: list.length * 50, color: '#ef4444' })
  emit('update-widget')
}

/**
 * 一键预置三档阈值（软告警模板）：高效告警 / 告警 / 正常。
 *
 * 数值按槽位量程的 80% / 60% / 下限算，没有声明量程的槽位按 0~100。
 * 「级别文本」只在前两档填，最低一档留空 —— 画面软告警面板按这个约定
 * 判断「命中且带级别文本」才算越限，用户可再逐档改数值与文本。
 */
function presetThresholds(binding: ScadaWidgetBinding, spec: ScadaBindingSlotSpec) {
  const min = Number(spec.min ?? 0)
  const max = Number.isFinite(Number(spec.max)) && Number(spec.max) > min ? Number(spec.max) : min + 100
  const high = Math.round((min + (max - min) * 0.8) * 100) / 100
  const mid = Math.round((min + (max - min) * 0.6) * 100) / 100
  binding.thresholds = [
    { limit: high, color: '#ef4444', text: '高高限' },
    { limit: mid, color: '#f59e0b', text: '高限' },
    { limit: min, color: '#22c55e', text: '' },
  ]
  emit('update-widget')
}

function removeThreshold(binding: ScadaWidgetBinding, index: number) {
  binding.thresholds?.splice(index, 1)
  emit('update-widget')
}

function updateThreshold(binding: ScadaWidgetBinding, index: number, patch: Partial<ScadaStateThreshold>) {
  const item = binding.thresholds?.[index]
  if (!item) return
  Object.assign(item, patch)
  emit('update-widget')
}

function textMapEntries(binding: ScadaWidgetBinding): Array<[string, string]> {
  return Object.entries(binding.textMap ?? {})
}

function setTextMap(binding: ScadaWidgetBinding, key: string, value: string) {
  if (!binding.textMap) binding.textMap = {}
  binding.textMap[key] = value
  emit('update-widget')
}

function removeTextMap(binding: ScadaWidgetBinding, key: string) {
  if (!binding.textMap) return
  delete binding.textMap[key]
  emit('update-widget')
}

function addTextMap(binding: ScadaWidgetBinding) {
  if (!binding.textMap) binding.textMap = {}
  binding.textMap['0'] = '关'
  emit('update-widget')
}

const canvasForm = computed(() => props.document.canvas)

function updateCanvas(patch: Partial<ScadaDocument['canvas']>) {
  Object.assign(props.document.canvas, patch)
  emit('update-canvas')
}
</script>

<template>
  <div class="scada-inspector">
    <div v-if="!widget" class="scada-inspector__empty">
      <div class="scada-inspector__empty-title">
        {{ selectedCount > 1 ? `已选中 ${selectedCount} 个图元` : '未选中图元' }}
      </div>
      <div class="scada-inspector__empty-text">
        {{ selectedCount > 1 ? '多选只支持整体移动、旋转与层级调整；要改属性请单独选中一个图元。' : '在画布上点选图元，或从左侧图元库添加。' }}
      </div>
      <div class="scada-inspector__canvas-form">
        <div class="scada-field-row">
          <span>画布宽</span>
          <el-input-number
            :model-value="canvasForm.width"
            :min="320"
            :max="7680"
            :step="80"
            size="small"
            controls-position="right"
            @update:model-value="updateCanvas({ width: Number($event) || canvasForm.width })"
          />
        </div>
        <div class="scada-field-row">
          <span>画布高</span>
          <el-input-number
            :model-value="canvasForm.height"
            :min="240"
            :max="4320"
            :step="90"
            size="small"
            controls-position="right"
            @update:model-value="updateCanvas({ height: Number($event) || canvasForm.height })"
          />
        </div>
        <div class="scada-field-row">
          <span>栅格</span>
          <el-input-number
            :model-value="canvasForm.grid"
            :min="0"
            :max="100"
            :step="5"
            size="small"
            controls-position="right"
            @update:model-value="updateCanvas({ grid: Number($event) || 0 })"
          />
        </div>
        <div class="scada-field-row">
          <span>背景色</span>
          <el-color-picker
            :model-value="canvasForm.background"
            size="small"
            @update:model-value="updateCanvas({ background: String($event ?? '#0f172a') })"
          />
        </div>
        <div class="scada-field-row">
          <span>显示栅格</span>
          <el-switch
            :model-value="canvasForm.showGrid"
            size="small"
            @update:model-value="updateCanvas({ showGrid: Boolean($event) })"
          />
        </div>
      </div>
    </div>

    <template v-else>
      <div class="scada-inspector__head">
        <div class="scada-inspector__title-line">
          <span class="scada-inspector__symbol">{{ symbol?.name ?? widget.symbolKey }}</span>
          <el-tag size="small" effect="plain">{{ widget.symbolKey }}</el-tag>
        </div>
        <div class="scada-inspector__actions">
          <el-tooltip content="顺时针旋转 90°" placement="bottom">
            <el-button size="small" :icon="Position" circle @click="emit('rotate')" />
          </el-tooltip>
          <el-tooltip content="复制一份" placement="bottom">
            <el-button size="small" text @click="emit('duplicate')">复制</el-button>
          </el-tooltip>
          <el-tooltip :content="widget.locked ? '解除锁定' : '锁定图元'" placement="bottom">
            <el-button size="small" text @click="emit('toggle-lock')">{{ widget.locked ? '解锁' : '锁定' }}</el-button>
          </el-tooltip>
          <el-tooltip content="删除" placement="bottom">
            <el-button size="small" type="danger" text :icon="Delete" @click="emit('delete')" />
          </el-tooltip>
        </div>
      </div>

      <div class="scada-inspector__ident">
        <el-input v-model="widget.name" size="small" placeholder="图元名称" @change="emit('update-widget')" />
      </div>

      <div class="scada-inspector__geometry">
        <span>X {{ Math.round(widget.rect.x) }}</span>
        <span>Y {{ Math.round(widget.rect.y) }}</span>
        <span>W {{ Math.round(widget.rect.width) }}</span>
        <span>H {{ Math.round(widget.rect.height) }}</span>
        <span>旋转 {{ rotationLabel }}</span>
      </div>

      <el-tabs class="scada-inspector__tabs">
        <el-tab-pane label="属性">
          <div v-if="!propGroups.length" class="scada-inspector__note">该图元没有可编辑属性。</div>
          <section v-for="group in propGroups" :key="group.group" class="scada-inspector__group">
            <div class="scada-inspector__group-title">{{ group.group }}</div>
            <div v-for="item in group.items" :key="item.spec.key" class="scada-field-row">
              <span :title="item.spec.key">{{ item.spec.label }}</span>
              <el-input
                v-if="item.spec.kind === 'text'"
                :model-value="String(item.value ?? '')"
                size="small"
                @update:model-value="setProp(item.spec, $event)"
              />
              <el-input-number
                v-else-if="item.spec.kind === 'number'"
                :model-value="Number(item.value ?? 0)"
                :min="item.spec.min ?? undefined"
                :max="item.spec.max ?? undefined"
                size="small"
                controls-position="right"
                @update:model-value="setProp(item.spec, Number($event ?? 0))"
              />
              <el-switch
                v-else-if="item.spec.kind === 'boolean'"
                :model-value="Boolean(item.value)"
                size="small"
                @update:model-value="setProp(item.spec, Boolean($event))"
              />
              <el-color-picker
                v-else-if="item.spec.kind === 'color'"
                :model-value="String(item.value ?? '#000000')"
                size="small"
                @update:model-value="setProp(item.spec, String($event ?? ''))"
              />
              <el-select
                v-else-if="item.spec.kind === 'choice'"
                :model-value="String(item.value ?? '')"
                size="small"
                @update:model-value="setProp(item.spec, $event)"
              >
                <el-option
                  v-for="choice in item.spec.choices ?? []"
                  :key="choice"
                  :label="choice"
                  :value="choice"
                />
              </el-select>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane :label="`变量绑定 (${bindings.filter((item) => item.binding).length}/${bindings.length})`">
          <div v-if="!bindings.length" class="scada-inspector__note">该图元没有绑定槽位。</div>
          <section v-for="item in bindings" :key="item.slot.key" class="scada-binding">
            <div class="scada-binding__head">
              <span class="scada-binding__label">{{ item.slot.label }}</span>
              <el-tag size="small" effect="plain">{{ item.slot.style }}</el-tag>
            </div>
            <div class="scada-binding__tag" :class="{ 'is-empty': !item.binding }">
              <div class="scada-binding__tag-main">
                <template v-if="item.option">
                  <span class="scada-binding__tag-name">{{ item.option.name }}</span>
                  <span class="scada-binding__tag-path">{{ item.option.path }}</span>
                </template>
                <template v-else-if="item.binding">
                  <span class="scada-binding__tag-name">{{ item.binding.tagLabel ?? `变量 #${item.binding.tagId}` }}</span>
                  <span class="scada-binding__tag-path">变量已不存在或不属于当前工程</span>
                </template>
                <span v-else class="scada-binding__tag-empty">未绑定</span>
              </div>
              <div class="scada-binding__tag-actions">
                <el-button size="small" :icon="Link" @click="emit('pick-tag', item.slot.key)">
                  {{ item.binding ? '更换' : '选择' }}
                </el-button>
                <el-button
                  v-if="item.binding"
                  size="small"
                  text
                  @click="emit('clear-binding', item.slot.key)"
                >
                  清除
                </el-button>
              </div>
            </div>

            <template v-if="item.binding">
              <div
                v-if="item.slot.style === 'valueText' || item.slot.style === 'textMap'"
                class="scada-field-row"
              >
                <span>小数位</span>
                <el-input-number
                  :model-value="item.binding.precision ?? item.slot.precision ?? 0"
                  :min="0"
                  :max="6"
                  size="small"
                  controls-position="right"
                  @update:model-value="setBindingField(item.binding, 'precision', $event)"
                />
              </div>
              <div v-if="item.slot.style === 'valueText'" class="scada-field-row">
                <span>单位</span>
                <el-input
                  :model-value="item.binding.unit ?? item.slot.unit ?? ''"
                  size="small"
                  placeholder="如 ℃ / MPa"
                  @update:model-value="setBindingField(item.binding, 'unit', $event)"
                />
              </div>
              <div v-if="item.slot.style === 'fillRatio' || item.slot.style === 'needle'" class="scada-binding__range">
                量程 {{ item.slot.min }} ~ {{ item.slot.max }}（由图元定义，超出按边界截断）
              </div>
              <div v-if="item.slot.style === 'stateColor'" class="scada-binding__map">
                <div class="scada-binding__map-head">
                  <span>状态阈值（按 limit 降序匹配）</span>
                  <span class="scada-binding__map-actions">
                    <el-button size="small" text @click="presetThresholds(item.binding!, item.slot)">预置三档</el-button>
                    <el-button size="small" text @click="addThreshold(item.binding!)">添加</el-button>
                  </span>
                </div>
                <div
                  v-for="(threshold, index) in item.binding.thresholds ?? []"
                  :key="`threshold-${index}`"
                  class="scada-binding__map-row scada-binding__map-row--threshold"
                >
                  <span class="scada-binding__map-op">≥</span>
                  <el-input-number
                    :model-value="threshold.limit"
                    size="small"
                    :step="10"
                    controls-position="right"
                    @update:model-value="updateThreshold(item.binding!, index, { limit: Number($event ?? 0) })"
                  />
                  <el-color-picker
                    :model-value="threshold.color"
                    size="small"
                    @update:model-value="updateThreshold(item.binding!, index, { color: String($event ?? '#64748b') })"
                  />
                  <el-button size="small" text type="danger" @click="removeThreshold(item.binding!, index)">×</el-button>
                  <el-input
                    class="scada-binding__map-level"
                    :model-value="threshold.text ?? ''"
                    size="small"
                    placeholder="级别文本（留空=正常，不报警）"
                    @update:model-value="updateThreshold(item.binding!, index, { text: String($event ?? '') })"
                  />
                </div>
                <div v-if="!(item.binding.thresholds ?? []).length" class="scada-inspector__note">
                  未配置阈值时统一用中性灰 #64748b。
                </div>
                <div v-else class="scada-inspector__note">
                  填了级别文本的档位算告警：右上角「软告警」会列出当前越限的点，画面同时按该档颜色染色。
                </div>
              </div>
              <div
                v-if="item.slot.style === 'textMap' || item.slot.style === 'stateColor'"
                class="scada-binding__map"
              >
                <div class="scada-binding__map-head">
                  <span>{{ item.slot.style === 'textMap' ? '文本映射（原始值 → 显示文本）' : '文本映射（文本值 → 颜色）' }}</span>
                  <el-button size="small" text @click="addTextMap(item.binding!)">添加</el-button>
                </div>
                <div
                  v-for="[key, value] in textMapEntries(item.binding)"
                  :key="`textmap-${key}`"
                  class="scada-binding__map-row scada-binding__map-row--text"
                >
                  <span class="scada-binding__map-key" :title="key">{{ key }}</span>
                  <span class="scada-binding__map-op">→</span>
                  <el-input
                    :model-value="value"
                    size="small"
                    placeholder="显示文本 / 颜色"
                    @update:model-value="setTextMap(item.binding!, key, String($event))"
                  />
                  <el-button size="small" text type="danger" @click="removeTextMap(item.binding!, key)">×</el-button>
                </div>
              </div>
            </template>
          </section>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<style scoped>
.scada-inspector {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 16px;
}

.scada-inspector__empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scada-inspector__empty-title {
  font-size: 13px;
  font-weight: 600;
}

.scada-inspector__empty-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-text, #8d98b2);
}

.scada-inspector__canvas-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px dashed var(--card-border, rgba(255, 255, 255, 0.1));
}

.scada-inspector__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px 8px;
}

/* 右侧面板只有 ~288px：窄屏时让操作按钮换行，避免把图元名挤成「指...」。 */
.scada-inspector__title-line {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.scada-inspector__symbol {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scada-inspector__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.scada-inspector__ident :deep(.el-input__inner) {
  font-size: 12px;
}

.scada-inspector__geometry {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}

.scada-inspector__tabs :deep(.el-tabs__header) {
  margin-bottom: 6px;
}

.scada-inspector__group {
  margin-bottom: 10px;
}

.scada-inspector__group-title {
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-text, #8d98b2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.scada-inspector__note {
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted-text, #8d98b2);
}

.scada-field-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.scada-field-row > span {
  overflow: hidden;
  color: var(--muted-text, #8d98b2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scada-binding {
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.scada-binding__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.scada-binding__label {
  font-size: 12px;
  font-weight: 600;
}

.scada-binding__tag {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed rgba(56, 189, 248, 0.35);
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.06);
}

.scada-binding__tag.is-empty {
  border-color: var(--card-border, rgba(255, 255, 255, 0.08));
  background: transparent;
}

.scada-binding__tag-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.scada-binding__tag-name {
  font-size: 12px;
  font-weight: 600;
}

.scada-binding__tag-path {
  overflow: hidden;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scada-binding__tag-empty {
  font-size: 12px;
  color: var(--muted-text, #8d98b2);
}

.scada-binding__tag-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.scada-binding__range {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}

.scada-binding__map {
  margin-top: 8px;
}

.scada-binding__map-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}

.scada-binding__map-row {
  display: grid;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.scada-binding__map-row--threshold {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
}

.scada-binding__map-row--text {
  grid-template-columns: auto auto minmax(0, 1fr) auto;
}

.scada-binding__map-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.scada-binding__map-level {
  grid-column: 2 / -1;
}

.scada-binding__map-op {
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}

.scada-binding__map-key {
  overflow: hidden;
  max-width: 88px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
