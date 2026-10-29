<!-- 通道变量选择器：列出工程内**全部**通道变量（含停用），支持搜索与按可写过滤。
     数据来自 GET /api/v1/scada/tags?projectId=，一次取全量，不再按资产节点逐级请求。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { ScadaTagOption } from '@/shared/scada/types'
import { isWritableAccessMode } from '@/shared/scada/types'
import { describeTagAddress } from '@/shared/scada/render'

const props = defineProps<{
  modelValue: boolean
  options: ScadaTagOption[]
  loading?: boolean | undefined
  /** 只列可写变量（下发类槽位使用）。 */
  writableOnly?: boolean | undefined
  title?: string | undefined
  hint?: string | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', option: ScadaTagOption): void
}>()

const keyword = ref('')
const onlyWritable = ref(Boolean(props.writableOnly))
const onlyEnabled = ref(false)
const activeCategory = ref<'all' | 'analog' | 'digital' | 'other'>('all')

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      keyword.value = ''
      onlyWritable.value = Boolean(props.writableOnly)
      onlyEnabled.value = false
      activeCategory.value = 'all'
    }
  },
)

function categoryOf(option: ScadaTagOption): 'analog' | 'digital' | 'other' {
  const type = (option.dataTypeName ?? '').toUpperCase()
  const channel = (option.channelType ?? '').toUpperCase()
  if (type.includes('FLOAT') || type.includes('DOUBLE') || type.includes('WORD') || channel.startsWith('AI') || channel.startsWith('AO')) {
    return 'analog'
  }
  if (type.includes('BOOL') || channel.startsWith('DI') || channel.startsWith('DO')) {
    return 'digital'
  }
  return 'other'
}

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return props.options.filter((option) => {
    if (onlyWritable.value && !isWritableAccessMode(option.accessMode)) return false
    if (onlyEnabled.value && !option.enabled) return false
    if (activeCategory.value !== 'all' && categoryOf(option) !== activeCategory.value) return false
    if (!needle) return true
    const haystack = [
      option.name,
      option.path,
      option.assetNodeName,
      option.physicalName ?? '',
      option.channelType ?? '',
      String(option.channelNo ?? ''),
      option.dataTypeName,
      option.registerTypeName,
      String(option.registerAddress),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
})

const summary = computed(() => {
  const writable = props.options.filter((item) => isWritableAccessMode(item.accessMode)).length
  return `共 ${props.options.length} 个通道变量 · 可写 ${writable} 个`
})

function close() {
  emit('update:modelValue', false)
}

function choose(option: ScadaTagOption) {
  emit('select', option)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title ?? '选择通道变量'"
    width="820px"
    top="6vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="scada-tag-picker">
      <div class="scada-tag-picker__hint">
        {{ hint ?? '列出当前工程的全部通道变量（含停用），选中后图元按变量值实时回显。' }}
      </div>
      <div class="scada-tag-picker__toolbar">
        <el-input
          v-model="keyword"
          size="default"
          clearable
          placeholder="按变量名 / 路径 / 通道 / 地址搜索"
          :prefix-icon="Search"
        />
        <el-select v-model="activeCategory" size="default" class="scada-tag-picker__category">
          <el-option label="全部类型" value="all" />
          <el-option label="模拟量" value="analog" />
          <el-option label="开关量" value="digital" />
          <el-option label="其他" value="other" />
        </el-select>
        <el-checkbox v-model="onlyWritable" label="仅可写" />
        <el-checkbox v-model="onlyEnabled" label="仅启用" />
      </div>
      <div class="scada-tag-picker__summary">{{ summary }} · 匹配 {{ filtered.length }} 个</div>
      <div v-loading="loading" class="scada-tag-picker__list">
        <button
          v-for="option in filtered"
          :key="option.tagId"
          type="button"
          class="scada-tag-row"
          @click="choose(option)"
        >
          <div class="scada-tag-row__main">
            <span class="scada-tag-row__name">{{ option.name }}</span>
            <span class="scada-tag-row__path">{{ option.path }}</span>
          </div>
          <div class="scada-tag-row__meta">
            <el-tag size="small" effect="plain" :type="isWritableAccessMode(option.accessMode) ? 'success' : 'info'">
              {{ option.accessMode || '—' }}
            </el-tag>
            <el-tag v-if="!option.enabled" size="small" effect="plain" type="warning">停用</el-tag>
            <span class="scada-tag-row__address">{{ describeTagAddress(option) }}</span>
            <span class="scada-tag-row__value">
              {{ option.currentValueText ?? '—' }}
            </span>
          </div>
        </button>
        <div v-if="!filtered.length && !loading" class="scada-tag-picker__empty">
          没有匹配的通道变量。先在上位机工程里建立模块与通道，再回组态绑定。
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.scada-tag-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.scada-tag-picker__hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-text, #8d98b2);
}

.scada-tag-picker__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px auto auto;
  align-items: center;
  gap: 8px;
}

.scada-tag-picker__summary {
  font-size: 12px;
  color: var(--muted-text, #8d98b2);
}

.scada-tag-picker__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 52vh;
  min-height: 180px;
  overflow: auto;
  padding-right: 4px;
}

.scada-tag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.scada-tag-row:hover {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.08);
}

.scada-tag-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.scada-tag-row__name {
  font-size: 13px;
  font-weight: 600;
}

.scada-tag-row__path {
  overflow: hidden;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scada-tag-row__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}

.scada-tag-row__value {
  min-width: 60px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
}

.scada-tag-picker__empty {
  padding: 24px 0;
  font-size: 12px;
  color: var(--muted-text, #8d98b2);
  text-align: center;
}

@media (max-width: 900px) {
  .scada-tag-picker__toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
