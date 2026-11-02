<script setup lang="ts">
// 系统设置：一个由插件贡献拼出来的设置页。
//
// 三条约束：
// 1. 页面本身不认识任何业务字段——标签页、卡片、控件、校验全部来自 `ctx.settings`；
// 2. 必填星号与提交校验同源（`SettingField.required` 生成的规则），不靠提交后报错；
// 3. 每个分组只有一个入口（本页的标签页），插件不再各自建「XX 设置」菜单。
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormItemRule } from 'element-plus'
import { Refresh, RefreshLeft } from '@element-plus/icons-vue'
import {
  filterByPermission,
  type SettingAction,
  type SettingBlock,
  type SettingField,
  type SettingGroup,
  type SettingSectionContribution,
  type SettingValues,
} from '@/kernel'
import { getKernel } from '@/router'
import { useKernelStore } from '@/stores/kernel'
import { useSessionStore } from '@/stores/session'
import { canonical, cloneValue, getPath, setPath } from '@/shared/values'
import SettingFieldControl from './components/SettingField.vue'

interface SectionState {
  values: SettingValues
  /** 已保存值的稳定序列化，用于判脏。 */
  snapshot: string
  loading: boolean
  saving: boolean
  loaded: boolean
}

interface RenderBlock extends SettingBlock {
  fields: SettingField[]
}

const route = useRoute()
const router = useRouter()
const kernelStore = useKernelStore()
const session = useSessionStore()

const states = reactive<Record<string, SectionState>>({})
const formRefs: Record<string, FormInstance | undefined> = {}
const activeId = ref('')
const runningAction = ref('')

const sections = computed<SettingSectionContribution[]>(() => {
  const kernel = getKernel()
  if (!kernel) return []
  // 显式依赖插件启停与权限：停用插件或收窄权限后，对应设置立刻消失。
  void kernelStore.statuses
  const enabled = new Set(kernelStore.statuses.filter((item) => item.enabled).map((item) => item.id))
  return filterByPermission(
    kernel.settingContributions().filter((section) => !section.pluginId || enabled.has(section.pluginId)),
    session.permissions,
  )
})

const groups = computed<SettingGroup[]>(() => {
  const seen = new Map<string, SettingGroup>()
  for (const section of sections.value) {
    if (!seen.has(section.group.id)) seen.set(section.group.id, section.group)
  }
  return [...seen.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title))
})

const activeGroup = computed(() => groups.value.find((group) => group.id === activeId.value) ?? groups.value[0])
const activeSections = computed(() =>
  activeGroup.value ? sections.value.filter((section) => section.group.id === activeGroup.value?.id) : [],
)

// 深链接：`/system/settings?tab=assistant` 可以直接落到某个分组；
// 分组被插件停用后自动回落，不停留在空白 tab。
watch(
  [groups, () => route.query.tab],
  () => {
    const wanted = typeof route.query.tab === 'string' ? route.query.tab : ''
    const exists = groups.value.some((group) => group.id === wanted)
    if (exists) {
      if (activeId.value !== wanted) activeId.value = wanted
      return
    }
    const fallback = groups.value[0]?.id ?? ''
    if (activeId.value !== fallback) activeId.value = fallback
    if (wanted && fallback) void router.replace({ query: { ...route.query, tab: fallback } })
  },
  { immediate: true },
)

watch(
  () => sections.value.map((section) => section.id).join('|'),
  () => {
    for (const section of sections.value) stateOf(section)
  },
  { immediate: true },
)

watch(
  () => activeSections.value.map((section) => `${section.id}:${section.pluginId ?? ''}`).join('|'),
  () => {
    for (const section of activeSections.value) void loadSection(section)
  },
  { immediate: true },
)

function selectGroup(group: SettingGroup): void {
  activeId.value = group.id
  void router.replace({ query: { ...route.query, tab: group.id } })
}

function stateOf(section: SettingSectionContribution): SectionState {
  let state = states[section.id]
  if (!state) {
    state = reactive<SectionState>({ values: {}, snapshot: canonical({}), loading: false, saving: false, loaded: false })
    states[section.id] = state
  }
  return state
}

function setFormRef(id: string, instance: unknown): void {
  if (instance) formRefs[id] = instance as FormInstance
  else delete formRefs[id]
}

async function loadSection(section: SettingSectionContribution, force = false): Promise<void> {
  const state = stateOf(section)
  if (state.loading || (state.loaded && !force)) return
  if (!section.load) return
  state.loading = true
  try {
    const values = await section.load()
    state.values = cloneValue(values)
    state.snapshot = canonical(values)
    state.loaded = true
    section.onChange?.(cloneValue(state.values))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : `读取「${section.title}」失败`)
  } finally {
    state.loading = false
  }
}

function dirtyOf(section: SettingSectionContribution): boolean {
  const state = stateOf(section)
  return state.loaded && canonical(state.values) !== state.snapshot
}

function hintOf(field: SettingField, values: SettingValues): string {
  if (typeof field.hint === 'function') return field.hint(values)
  return field.hint ?? ''
}

function blocksOf(section: SettingSectionContribution, values: SettingValues): RenderBlock[] {
  const fields = (section.fields ?? []).filter((field) => field.visible?.(values) !== false)
  if (fields.length === 0) return []
  const declared = section.blocks ?? []
  if (declared.length === 0) return [{ id: 'default', title: '', fields }]

  const buckets = new Map<string, SettingField[]>()
  const loose: SettingField[] = []
  for (const field of fields) {
    if (!field.block || !declared.some((block) => block.id === field.block)) {
      loose.push(field)
      continue
    }
    const bucket = buckets.get(field.block) ?? []
    bucket.push(field)
    buckets.set(field.block, bucket)
  }

  const result: RenderBlock[] = []
  for (const block of declared) {
    const bucket = buckets.get(block.id) ?? []
    if (bucket.length) result.push({ ...block, fields: bucket })
  }
  if (loose.length) result.push({ id: '__other', title: '其他', fields: loose })
  return result
}

/**
 * 规则与星号同源：`required` 既生成 Element 的必填规则（标签自动带星号），
 * 也参与提交校验；函数形式按当前值决定（例如已存过密钥时不再必填）。
 *
 * 规则挂在每个 form-item 上而不是 form 的 `rules` 上：字段 key 支持点路径，
 * Element 的 `getProp(formRules, prop)` 会按层级去找，扁平 key 匹配不到。
 */
function fieldRules(field: SettingField, values: SettingValues): FormItemRule[] {
  if (field.type === 'records' || field.type === 'tags' || field.type === 'json') return []
  const required = typeof field.required === 'function' ? field.required(values) : Boolean(field.required)
  const rules: FormItemRule[] = []
  if (required) {
    rules.push({
      required: true,
      ...(field.type === 'number' ? { type: 'number' as const } : {}),
      message: field.type === 'select' ? `请选择${field.label}` : `请填写${field.label}`,
      trigger: ['blur', 'change'],
    })
  }
  if (field.pattern) {
    rules.push({
      pattern: new RegExp(field.pattern),
      message: field.patternMessage ?? `${field.label}格式不正确`,
      trigger: 'blur',
    })
  }
  return rules
}

function updateField(section: SettingSectionContribution, field: SettingField, value: unknown): void {
  const state = stateOf(section)
  setPath(state.values, field.key, value)
  section.onChange?.(cloneValue(state.values))
}

async function saveSection(section: SettingSectionContribution): Promise<void> {
  if (!section.save) return
  const state = stateOf(section)
  const valid = await formRefs[section.id]?.validate().catch(() => false)
  if (valid === false) return
  state.saving = true
  try {
    const message = await section.save(cloneValue(state.values))
    ElMessage.success(message || `「${section.title}」已保存`)
    await loadSection(section, true)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : `保存「${section.title}」失败`)
  } finally {
    state.saving = false
  }
}

async function restoreDefaults(section: SettingSectionContribution): Promise<void> {
  if (!section.defaults) return
  const state = stateOf(section)
  try {
    state.values = cloneValue(await section.defaults())
    section.onChange?.(cloneValue(state.values))
    void formRefs[section.id]?.clearValidate()
    ElMessage.info('已填入后端默认值；确认后点「保存」才生效')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取默认值失败')
  }
}

function visibleActions(section: SettingSectionContribution): SettingAction[] {
  const values = stateOf(section).values
  return (section.actions ?? []).filter((action) => action.visible?.(values) !== false)
}

async function runAction(section: SettingSectionContribution, action: SettingAction): Promise<void> {
  const state = stateOf(section)
  runningAction.value = `${section.id}:${action.id}`
  try {
    const message = await action.run(cloneValue(state.values))
    if (message) ElMessage.success(message)
    if (action.reloadAfter) await loadSection(section, true)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : `${action.label}失败`)
  } finally {
    runningAction.value = ''
  }
}

function actionDisabled(section: SettingSectionContribution, action: SettingAction): boolean {
  const values = stateOf(section).values
  return action.disabled?.(values, { dirty: dirtyOf(section) }) ?? false
}

function valueOf(section: SettingSectionContribution, field: SettingField): unknown {
  return getPath(stateOf(section).values, field.key)
}
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1>系统设置</h1>
        <p>
          这个页面本身没有写死任何业务字段：标签页与表单都由插件贡献，内核按声明渲染控件、必填星号与校验。
          停用一个插件，它的设置会整块消失；新增一项配置只需插件多声明一个字段。
        </p>
      </div>
      <div class="page-actions">
        <el-tag type="info" effect="plain">{{ groups.length }} 个分组</el-tag>
        <el-tag type="info" effect="plain">{{ sections.length }} 个设置区</el-tag>
      </div>
    </header>

    <el-empty
      v-if="groups.length === 0"
      description="没有可配置的设置项：相关插件未启用，或当前账号没有对应权限"
    />

    <template v-else>
      <nav class="settings-tabs" aria-label="设置分组">
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          class="settings-tab"
          :class="{ 'is-active': group.id === activeGroup?.id }"
          @click="selectGroup(group)"
        >
          <el-icon v-if="group.icon"><component :is="group.icon" /></el-icon>
          <span>{{ group.title }}</span>
        </button>
      </nav>

      <section v-for="section in activeSections" :key="section.id" class="settings-section">
        <!-- 自定义面板：整块由插件自渲染自保存（实时预览这类交互不适合声明式字段）。 -->
        <template v-if="section.component">
          <header class="settings-section__head">
            <div>
              <h2>{{ section.title }}</h2>
              <p v-if="section.description">{{ section.description }}</p>
            </div>
          </header>
          <component :is="section.component" />
        </template>

        <!-- 声明式设置区：字段、卡片、校验、保存全部由内核渲染。 -->
        <div v-else class="panel settings-panel" v-loading="stateOf(section).loading">
          <header class="settings-panel__head">
            <div>
              <h2>{{ section.title }}</h2>
              <p v-if="section.description">{{ section.description }}</p>
            </div>
            <el-tag v-if="dirtyOf(section)" type="warning" effect="plain">有未保存的改动</el-tag>
            <el-tag v-else-if="stateOf(section).loaded" type="success" effect="plain">与已保存一致</el-tag>
          </header>

          <el-form
            v-if="stateOf(section).loaded"
            :ref="(instance: unknown) => setFormRef(section.id, instance)"
            :model="stateOf(section).values"
            label-position="top"
            class="settings-form"
          >
            <section v-for="block in blocksOf(section, stateOf(section).values)" :key="block.id" class="settings-block">
              <div v-if="block.title" class="settings-block__head">
                <h3>{{ block.title }}</h3>
                <span v-if="block.description">{{ block.description }}</span>
              </div>
              <div class="settings-grid">
                <el-form-item
                  v-for="field in block.fields"
                  :key="field.key"
                  :label="field.label"
                  :prop="field.key"
                  :rules="fieldRules(field, stateOf(section).values)"
                  :class="{ 'is-full': field.full || field.type === 'textarea' || field.type === 'records' || field.type === 'json' }"
                >
                  <SettingFieldControl
                    :field="field"
                    :values="stateOf(section).values"
                    :model-value="valueOf(section, field)"
                    @update:model-value="(value: unknown) => updateField(section, field, value)"
                  />
                  <p v-if="hintOf(field, stateOf(section).values)" class="field-hint">
                    {{ hintOf(field, stateOf(section).values) }}
                  </p>
                </el-form-item>
              </div>
            </section>
          </el-form>

          <footer class="settings-panel__foot">
            <div class="settings-actions">
              <el-button
                v-for="action in visibleActions(section)"
                :key="action.id"
                :type="action.kind ?? 'default'"
                :loading="runningAction === `${section.id}:${action.id}`"
                :disabled="actionDisabled(section, action)"
                @click="runAction(section, action)"
              >
                <el-icon v-if="action.icon"><component :is="action.icon" /></el-icon>
                <span>{{ action.label }}</span>
              </el-button>
              <el-button v-if="section.defaults" :icon="RefreshLeft" @click="restoreDefaults(section)">恢复默认值</el-button>
              <el-button :icon="Refresh" :loading="stateOf(section).loading" @click="loadSection(section, true)">重新读取</el-button>
              <el-button
                v-if="section.save"
                type="primary"
                :loading="stateOf(section).saving"
                :disabled="!dirtyOf(section)"
                @click="saveSection(section)"
              >
                保存
              </el-button>
            </div>
          </footer>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-tabs {
  display: flex; align-items: center; gap: 6px; padding: 6px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  overflow-x: auto;
}
.settings-tab {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 7px 14px; border: 1px solid transparent; border-radius: calc(var(--radius) - 4px);
  background: transparent; color: var(--muted); font-size: 13px; cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.settings-tab:hover { color: var(--app-text); background: var(--surface-soft); }
.settings-tab.is-active { color: var(--brand); background: var(--brand-soft); border-color: var(--brand); font-weight: 600; }
.settings-section { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.settings-section__head h2 { margin: 0; font-size: 17px; color: var(--app-text); }
.settings-section__head p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--muted); max-width: 80ch; }
.settings-panel { display: flex; flex-direction: column; gap: 16px; }
.settings-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.settings-panel__head h2 { margin: 0; font-size: 16px; color: var(--app-text); }
.settings-panel__head p { margin: 6px 0 0; font-size: 12px; line-height: 1.7; color: var(--muted); max-width: 80ch; }
.settings-form { display: flex; flex-direction: column; gap: 18px; }
.settings-block + .settings-block { border-top: 1px dashed var(--line); padding-top: 16px; }
.settings-block__head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.settings-block__head h3 { margin: 0; font-size: 13.5px; color: var(--app-text); }
.settings-block__head span { font-size: 11.5px; color: var(--muted); }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; }
.settings-grid > .is-full { grid-column: 1 / -1; }
.settings-grid :deep(.el-form-item) { margin-bottom: 14px; }
.settings-grid :deep(.el-form-item__label) { padding-bottom: 4px; font-size: 12.5px; }
.field-hint { margin: 4px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
.settings-panel__foot { display: flex; justify-content: flex-end; border-top: 1px solid var(--line); padding-top: 14px; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
@media (max-width: 900px) {
  .settings-grid { grid-template-columns: 1fr; }
  .settings-panel__head { flex-direction: column; }
}
</style>
