<script setup lang="ts">
// 页面工厂：原型描述 → schema → 立即上线，全程不写 .vue。
//
// 左：后端已登记的页面（就是侧栏菜单的来源）。
// 中：schema 的 JSON 编辑器（结构化配置的唯一真相）。
// 右：AI 生成与说明。保存即 PUT /ui/pages/{key}，刷新后菜单出现。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Plus, Refresh } from '@element-plus/icons-vue'
import { useRuntime, useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'

interface PageSchemaPayload {
  key: string
  version: number
  schema: Record<string, unknown>
}

const http = useService<HttpClient>('http')
const runtime = useRuntime()
const aiEnabled = runtime.pluginEnabled('ai')

const pages = ref<PageSchemaPayload[]>([])
const loading = ref(false)
const saving = ref(false)
const selectedKey = ref('')
const draftKey = ref('')
const draftText = ref('')
const originalText = ref('')

const aiPrompt = ref('')
const aiLoading = ref(false)

const invalid = computed(() => {
  try {
    JSON.parse(draftText.value || '{}')
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : 'JSON 格式错误'
  }
})

const dirty = computed(() => draftText.value !== originalText.value)

const template = () => JSON.stringify(
  {
    key: draftKey.value || 'demo-page',
    title: '示例页面',
    entity: '示例',
    endpoint: '/demo-items',
    layout: 'table',
    menu: { title: '示例页面', group: '系统工具', icon: 'Grid', order: 99 },
    permissions: { view: 'demo:item:view', add: 'demo:item:add', edit: 'demo:item:edit', remove: 'demo:item:remove' },
    query: [{ prop: 'keyword', label: '关键字', control: 'input', placeholder: '名称 / 编号' }],
    columns: [
      { prop: 'id', label: 'ID', width: 80 },
      { prop: 'name', label: '名称', minWidth: 200 },
      { prop: 'createdAt', label: '创建时间', width: 170, cell: 'datetime' },
    ],
    fields: [
      { prop: 'name', label: '名称', control: 'input', required: true },
    ],
  },
  null,
  2,
)

async function load(prefer?: string): Promise<void> {
  loading.value = true
  try {
    pages.value = await http.request<PageSchemaPayload[]>('/ui/pages')
    // 注意用 ||：selectedKey 初始是空字符串，?? 不会回落到第一项。
    const target = prefer || selectedKey.value || pages.value[0]?.key || ''
    const found = pages.value.find((item) => item.key === target)
    if (found) select(found)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取页面清单失败')
  } finally {
    loading.value = false
  }
}

function select(page: PageSchemaPayload): void {
  selectedKey.value = page.key
  draftKey.value = page.key
  draftText.value = JSON.stringify(page.schema, null, 2)
  originalText.value = draftText.value
}

function createNew(): void {
  selectedKey.value = ''
  draftKey.value = ''
  ElMessageBox.prompt('新页面的 key（同时是接口路径与菜单标识，例如 device-ledger）', '新建页面', {
    inputPattern: /^[a-z][a-z0-9-]{1,40}$/,
    inputErrorMessage: '小写字母开头，只含小写字母、数字与 -',
  }).then(({ value }) => {
    draftKey.value = value
    draftText.value = template()
    originalText.value = ''
  }).catch(() => undefined)
}

async function save(): Promise<void> {
  if (invalid.value) {
    ElMessage.warning(`JSON 有问题：${invalid.value}`)
    return
  }
  const key = draftKey.value.trim()
  if (!key) {
    ElMessage.warning('先给页面一个 key')
    return
  }
  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(draftText.value)
  } catch {
    return
  }
  schema.key = key
  saving.value = true
  try {
    await http.request(`/ui/pages/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(schema) })
    draftText.value = JSON.stringify(schema, null, 2)
    originalText.value = draftText.value
    selectedKey.value = key
    await load(key)
    ElMessage.success('已保存：刷新页面后菜单出现（已开启的页面立即生效）')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => load())

async function generate(): Promise<void> {
  const prompt = aiPrompt.value.trim()
  if (!prompt) return
  aiLoading.value = true
  try {
    const baseline = pages.value
      .slice(0, 12)
      .map((item) => `${item.key}：${String((item.schema as { title?: unknown }).title ?? '')}`)
      .join('；')
    const result = await http.request<{ schema: Record<string, unknown>; model: string }>('/ai/schema', {
      method: 'POST',
      body: JSON.stringify({ prompt, baseline }),
    })
    if (typeof result.schema.key === 'string') draftKey.value = result.schema.key
    draftText.value = JSON.stringify(result.schema, null, 2)
    ElMessage.success(`已按原型生成草稿（${result.model}），确认后点保存`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生成失败')
  } finally {
    aiLoading.value = false
  }
}

function openPage(): void {
  const schema = pages.value.find((item) => item.key === selectedKey.value)?.schema as { menu?: { path?: string; hidden?: boolean } } | undefined
  const path = schema?.menu?.path ?? `/p/${selectedKey.value || draftKey.value}`
  window.open(path, '_blank', 'noopener')
}
</script>

<template>
  <div class="page" v-loading="loading">
    <header class="page-head">
      <div>
        <h1>页面工厂</h1>
        <p>一张原型 + 一段描述就能上线一页：schema 是唯一真相，侧栏菜单、查询、表格、表单都由它生成。</p>
      </div>
      <div class="page-actions">
        <el-tag v-if="dirty" type="warning" effect="plain">草稿未保存</el-tag>
        <el-button :icon="Refresh" @click="load()">重新读取</el-button>
        <el-button :icon="Plus" @click="createNew">新建页面</el-button>
        <el-button :disabled="!selectedKey" @click="openPage">打开页面</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存并上线</el-button>
      </div>
    </header>

    <div class="studio" :class="{ 'studio--no-ai': !aiEnabled }">
      <aside class="panel studio-list">
        <div class="panel-title">
          <h2>已登记页面</h2>
          <span>{{ pages.length }}</span>
        </div>
        <button
          v-for="item in pages"
          :key="item.key"
          type="button"
          class="studio-list__item"
          :class="{ 'is-active': item.key === selectedKey }"
          @click="select(item)"
        >
          <span class="studio-list__title">{{ String(item.schema.title ?? item.key) }}</span>
          <span class="studio-list__meta">{{ item.key }} · v{{ item.version }}</span>
        </button>
        <p v-if="pages.length === 0" class="muted">还没有登记页面。</p>
      </aside>

      <section class="panel studio-editor">
        <div class="panel-title">
          <h2>页面 schema</h2>
          <el-input v-model="draftKey" class="studio-key" placeholder="页面 key" />
        </div>
        <el-input
          v-model="draftText"
          type="textarea"
          :rows="22"
          resize="vertical"
          class="studio-code"
          spellcheck="false"
          placeholder="粘贴或生成 schema JSON"
        />
        <p v-if="invalid" class="studio-error">JSON 解析失败：{{ invalid }}</p>
      </section>

      <section v-if="aiEnabled" class="panel studio-ai">
        <div class="panel-title">
          <h2>AI 生成</h2>
          <el-tag size="small" effect="plain">page.schema</el-tag>
        </div>
        <el-input
          v-model="aiPrompt"
          type="textarea"
          :rows="6"
          placeholder="描述这张原型：模块、要看的字段、要填的字段、上下级关系。例如：设备台账，左边按部门树筛选，右侧列表显示型号/投运日期/状态，能新增和编辑"
        />
        <el-button class="studio-ai__go" type="primary" plain :icon="MagicStick" :loading="aiLoading" @click="generate">
          生成草稿
        </el-button>
        <div class="studio-help">
          <h3>写 schema 的要点</h3>
          <ul>
            <li><code>endpoint</code> 是数据接口，必须给；<code>columns[].prop</code> / <code>fields[].control</code> 是固定字段名。</li>
            <li>必填字段写 <code>required: true</code>，前端会在 label 上标 * 并在提交前校验。</li>
            <li>有上下级关系给 <code>tree</code>，页面自动变「左树右表」。</li>
            <li><code>menu.path</code> 决定地址；<code>menu.group</code> 决定侧栏分组。</li>
            <li>权限码统一 <code>模块:资源:动作</code>（view/add/edit/remove），与角色配置同一套。</li>
          </ul>
          <p class="muted">提示词本身在「AI 工作台 → 页面 schema」里，可以按自己的行业口径改写。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.studio { display: grid; grid-template-columns: 240px minmax(0, 1.4fr) minmax(0, .8fr); gap: 16px; align-items: start; }
.studio--no-ai { grid-template-columns: 240px minmax(0, 1fr); }
.studio-list { display: flex; flex-direction: column; gap: 4px; max-height: 720px; overflow: auto; }
.studio-list__item {
  display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
  padding: 9px 10px; border-radius: 9px; border: 1px solid transparent; background: transparent; color: var(--app-text);
}
.studio-list__item:hover { background: var(--hover); }
.studio-list__item.is-active { border-color: var(--brand); background: var(--brand-soft); }
.studio-list__title { font-size: 13px; }
.studio-list__meta { font-size: 11px; color: var(--muted); }
.studio-editor { display: flex; flex-direction: column; gap: 10px; }
.studio-key { width: 200px; }
.studio-code :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.7; }
.studio-error { margin: 0; color: #f04438; font-size: 12px; }
.studio-ai { display: flex; flex-direction: column; gap: 12px; }
.studio-ai__go { align-self: flex-start; }
.studio-help h3 { margin: 8px 0; font-size: 13px; color: var(--app-text); }
.studio-help ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12px; line-height: 1.9; }
.studio-help code { font-family: ui-monospace, monospace; color: var(--brand); }
@media (max-width: 1200px) { .studio { grid-template-columns: 200px minmax(0, 1fr); } .studio-ai { grid-column: 1 / -1; } }
</style>
