<script setup lang="ts">
// AI 工作台：提示词库 + 对话调试。
//
// 提示词是「配置」不是代码：画原型的人在这里改系统提示，改完立刻影响画布生成，
// 不需要发版；服务端的占位符（{{catalog}} / {{document}} …）由后端在调用前填充。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatDotRound, Plus, Refresh, Promotion } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import {
  chat, deletePrompt, fetchAiConfig, fetchPrompts, resetPrompt, savePrompt,
  type AiConfigView, type AiPromptView,
} from '../api'

const http = useService<HttpClient>('http')

const config = ref<AiConfigView | null>(null)
const prompts = ref<AiPromptView[]>([])
const selectedId = ref<string>('scada.draw')
const loading = ref(false)
const saving = ref(false)

const draft = reactive({ id: '', title: '', scenario: 'general', description: '', system: '', maxOutputTokens: 1600 })

const chatInput = ref('')
const chatLog = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])

const selected = computed(() => prompts.value.find((item) => item.id === selectedId.value) ?? null)

const scenarios = [
  { value: 'scada.draw', label: '组态绘制' },
  { value: 'scada.layout', label: '组态排版' },
  { value: 'page.schema', label: '页面 schema' },
  { value: 'theme.tokens', label: '外观主题' },
  { value: 'general', label: '通用对话' },
]

function fill(prompt: AiPromptView | null): void {
  draft.id = prompt?.id ?? ''
  draft.title = prompt?.title ?? ''
  draft.scenario = prompt?.scenario ?? 'general'
  draft.description = prompt?.description ?? ''
  draft.system = prompt?.system ?? ''
  draft.maxOutputTokens = prompt?.maxOutputTokens ?? 1600
}

function select(prompt: AiPromptView): void {
  selectedId.value = prompt.id
  fill(prompt)
}

function createNew(): void {
  selectedId.value = ''
  fill(null)
  draft.title = '新提示词'
}

onMounted(async () => {
  try {
    const [configView, items] = await Promise.all([fetchAiConfig(http), fetchPrompts(http)])
    config.value = configView
    prompts.value = items
    fill(items.find((item) => item.id === 'scada.draw') ?? items[0] ?? null)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取 AI 配置失败')
  }
})

async function save(): Promise<void> {
  if (!draft.system.trim()) {
    ElMessage.warning('提示词内容不能为空')
    return
  }
  saving.value = true
  try {
    const saved = await savePrompt(http, {
      ...(draft.id ? { id: draft.id } : {}),
      title: draft.title,
      scenario: draft.scenario,
      description: draft.description,
      system: draft.system,
      maxOutputTokens: draft.maxOutputTokens,
    })
    prompts.value = prompts.value.some((item) => item.id === saved.id)
      ? prompts.value.map((item) => (item.id === saved.id ? saved : item))
      : [...prompts.value, saved]
    selectedId.value = saved.id
    fill(saved)
    ElMessage.success('已保存，下一次生成就生效')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function restore(): Promise<void> {
  if (!draft.id) return
  try {
    const restored = await resetPrompt(http, draft.id)
    prompts.value = prompts.value.map((item) => (item.id === restored.id ? restored : item))
    fill(restored)
    ElMessage.success('已恢复出厂提示词')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

async function remove(): Promise<void> {
  if (!draft.id) return
  try {
    await ElMessageBox.confirm('删除这条提示词？内置提示词需要先复制成自定义的再删。', '删除提示词', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deletePrompt(http, draft.id)
    prompts.value = prompts.value.filter((item) => item.id !== draft.id)
    createNew()
    ElMessage.success('已删除')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function send(): Promise<void> {
  const text = chatInput.value.trim()
  if (!text) return
  chatLog.value.push({ role: 'user', content: text })
  chatInput.value = ''
  loading.value = true
  try {
    const result = await chat(http, {
      messages: chatLog.value,
      ...(selectedId.value ? { promptId: selectedId.value } : {}),
    })
    chatLog.value.push({ role: 'assistant', content: result.text || '（空回复）' })
  } catch (error) {
    chatLog.value.push({ role: 'assistant', content: error instanceof Error ? error.message : '调用失败' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page ai-studio">
    <header class="page-head">
      <div>
        <h1>AI 工作台</h1>
        <p>提示词即配置：在这里改系统提示，画布与页面生成立刻跟着变；不需要重新发版。</p>
      </div>
      <div class="page-actions">
        <el-tag v-if="config?.ready" type="success" effect="plain">{{ config.provider }} · {{ config.model }}</el-tag>
        <el-tag v-else type="warning" effect="plain">模型未配置</el-tag>
        <el-tag type="info" effect="plain">{{ config?.ops ?? 0 }} 条画布指令</el-tag>
      </div>
    </header>

    <div class="ai-grid">
      <aside class="panel ai-list">
        <div class="panel-title">
          <h2>提示词</h2>
          <el-button size="small" :icon="Plus" text @click="createNew">新建</el-button>
        </div>
        <button
          v-for="item in prompts"
          :key="item.id"
          type="button"
          class="ai-list__item"
          :class="{ 'is-active': item.id === selectedId }"
          @click="select(item)"
        >
          <span class="ai-list__title">{{ item.title }}</span>
          <span class="ai-list__meta">{{ item.scenario }}<template v-if="item.builtin"> · 内置</template></span>
        </button>
      </aside>

      <section class="panel ai-editor">
        <div class="ai-editor__row">
          <el-input v-model="draft.title" placeholder="标题" />
          <el-select v-model="draft.scenario" style="width: 150px">
            <el-option v-for="item in scenarios" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-tooltip content="单次输出 token 上限；画面复杂、被截断时调大" placement="top">
            <el-input-number v-model="draft.maxOutputTokens" :min="200" :max="8000" :step="200" style="width: 140px" />
          </el-tooltip>
        </div>
        <el-input v-model="draft.description" placeholder="一句话说明这条提示词解决什么场景" />
        <el-input
          v-model="draft.system"
          type="textarea"
          :rows="16"
          resize="vertical"
          placeholder="系统提示词。可用占位符：{{catalog}} 指令集、{{document}} 当前画布、{{variables}} 变量、{{symbols}} 图元、{{layout}} 布局体检"
        />
        <div class="ai-editor__actions">
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
          <el-button :icon="Refresh" :disabled="!draft.id || !selected?.builtin" @click="restore">恢复出厂</el-button>
          <el-button text type="danger" :disabled="!draft.id || selected?.builtin" @click="remove">删除</el-button>
          <span class="ai-editor__hint">占位符由后端填充；未知占位符会原样保留，便于排查拼写。</span>
        </div>
      </section>

      <section class="panel ai-chat">
        <div class="panel-title">
          <h2>对话调试</h2>
          <el-tag size="small" effect="plain">{{ selected?.title ?? '未选择提示词' }}</el-tag>
        </div>
        <div class="ai-chat__log">
          <p v-if="chatLog.length === 0" class="muted">用当前提示词发一句话，确认模型理解你的意图。</p>
          <div v-for="(item, index) in chatLog" :key="index" class="ai-chat__msg" :class="item.role">
            <span class="ai-chat__role">{{ item.role === 'user' ? '你' : 'AI' }}</span>
            <pre>{{ item.content }}</pre>
          </div>
        </div>
        <div class="ai-chat__input">
          <el-input v-model="chatInput" placeholder="例如：帮我把这个页面的字段补全" @keyup.enter="send">
            <template #append>
              <el-button :icon="ChatDotRound" :loading="loading" @click="send"><el-icon><Promotion /></el-icon></el-button>
            </template>
          </el-input>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ai-grid { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
.ai-list { display: flex; flex-direction: column; gap: 4px; }
.ai-list__item {
  display: flex; flex-direction: column; gap: 3px; text-align: left;
  padding: 9px 10px; border-radius: 9px; border: 1px solid transparent;
  background: transparent; color: var(--app-text); cursor: pointer;
}
.ai-list__item:hover { background: var(--hover); }
.ai-list__item.is-active { border-color: var(--brand); background: var(--brand-soft); }
.ai-list__title { font-size: 13px; }
.ai-list__meta { font-size: 11px; color: var(--muted); }
.ai-editor { display: flex; flex-direction: column; gap: 10px; }
.ai-editor__row { display: flex; gap: 10px; }
.ai-editor__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ai-editor__hint { color: var(--muted); font-size: 11px; }
.ai-chat { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 12px; }
.ai-chat__log { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow: auto; }
.ai-chat__msg { display: flex; gap: 10px; align-items: flex-start; }
.ai-chat__msg pre { margin: 0; padding: 9px 12px; border-radius: 10px; background: var(--surface-soft); font-size: 12px; line-height: 1.8; white-space: pre-wrap; max-width: 80ch; }
.ai-chat__msg.assistant pre { background: var(--brand-soft); }
.ai-chat__role { flex: none; font-size: 11px; color: var(--muted); padding-top: 10px; min-width: 20px; }
@media (max-width: 1100px) { .ai-grid { grid-template-columns: 1fr; } .ai-chat { grid-column: auto; } }
</style>
