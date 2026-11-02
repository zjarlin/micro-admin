<script setup lang="ts">
// 画布 AI 指令台：自然语言 → 指令集 → 预览 → 应用到画布。
//
// 这里刻意不做任何几何计算：服务端执行指令集并把「改好的文档 + 逐行问题」还回来，
// 前端只负责让人确认。同一套面板接到别的编辑器时，只要换掉 workbench 句柄。
//
// 与「页面助手」的分工写在界面第一行：要**对话式**驱动（多轮、自动点击、缺参追问）
// 就用页面助手那一个对话框——它已经通过 `ai.canvasTool` 拿到了画笔，不需要第二个对话框；
// 这个页签只做「一次生成、看得见的指令、按一下就应用」的确定路径。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, MagicStick, Promotion } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useScadaWorkbench } from '@/plugins/scada/workbench'
import { useRuntime } from '@/shared/service'
import { drawOnCanvas, fetchAiConfig, fetchPrompts, type AiConfigView, type AiDrawResult, type AiPromptView } from '../api'

/** 页面助手运行时（可选插件）：有它就能把同一句话丢进那个对话面板。 */
interface AssistantRuntime {
  available: { value: boolean }
  run: (task: string) => Promise<void>
}

const http = useService<HttpClient>('http')
const workbench = useScadaWorkbench()
const runtime = useRuntime()

/** 页面助手是否可用：插件被停用或没配好时为 false，界面据此隐藏「对话」入口。 */
const assistant = computed<AssistantRuntime | null>(() => {
  try {
    return runtime.service<AssistantRuntime>('page-agent.runtime')
  } catch {
    return null
  }
})
const assistantReady = computed(() => assistant.value?.available.value === true)

/** 用当前输入（或快捷示例）打开页面助手那一个对话框，在同一个任务里完成多轮修改。 */
async function openAssistant(): Promise<void> {
  const target = assistant.value
  if (!target) return
  const text = instruction.value.trim()
  const task = text
    ? `${text}\n（用 draw_on_scada_canvas 工具直接改当前组态画布）`
    : '看看当前组态画布，指出排版问题并用 draw_on_scada_canvas 做最小修正。'
  await target.run(task)
}

const prompts = ref<AiPromptView[]>([])
const promptId = ref('scada.draw')
const instruction = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const config = ref<AiConfigView | null>(null)
const result = ref<AiDrawResult | null>(null)
const showRaw = ref(false)

/** 给非技术用户的快捷入口：不写提示词也能试出效果。 */
const presets = [
  { label: '画一张水处理总览', text: '画一张水处理总览画面：包含原水箱、加压泵、出水压力表、1# 泵运行状态灯，标题锚定左上角，整体居中。' },
  { label: '检查排版', text: '检查当前画面的对齐与间距，只做最小修正，保持现有图元与绑定不变。' },
  { label: '补一个压力表', text: '在右下角补一个压力表，绑定出水压力变量，尺寸与现有仪表一致，与其它图元保持同样间距。' },
]

const draftable = computed(() => workbench.active.value)
const drawPrompts = computed(() => prompts.value.filter((item) => item.scenario === 'scada.draw' || item.scenario === 'scada.layout'))
const errorIssues = computed(() => result.value?.issues.filter((item) => item.severity === 'error') ?? [])
const warnIssues = computed(() => result.value?.issues.filter((item) => item.severity === 'warn') ?? [])

onMounted(async () => {
  try {
    const [configView, promptList] = await Promise.all([fetchAiConfig(http), fetchPrompts(http)])
    config.value = configView
    prompts.value = promptList
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '读取 AI 配置失败'
  }
})

async function generate(): Promise<void> {
  const handle = workbench.handle.value
  if (!handle) {
    ElMessage.warning('先打开一张组态画面，AI 才有画布可改')
    return
  }
  const text = instruction.value.trim()
  if (!text) {
    ElMessage.warning('先写一句话描述要画什么，或点上面的快捷示例')
    return
  }
  loading.value = true
  error.value = null
  result.value = null
  try {
    result.value = await drawOnCanvas(http, {
      prompt: text,
      promptId: promptId.value,
      document: handle.readDocument(),
      symbols: handle.readSymbols(),
      tags: handle.readTags(),
      selection: handle.readSelection(),
    })
    if (!result.value.applied.length) {
      error.value = '模型没有产出可执行的指令，可以换个说法再试一次。'
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '生成失败'
  } finally {
    loading.value = false
  }
}

function apply(): void {
  const handle = workbench.handle.value
  if (!handle || !result.value) return
  handle.writeDocument(result.value.document)
  ElMessage.success(`已应用 ${result.value.applied.length} 条指令，记得保存画面`)
  result.value = null
  instruction.value = ''
}

function usePreset(text: string): void {
  instruction.value = text
}
</script>

<template>
  <div class="ai-draw">
    <div class="ai-draw__head">
      <el-tag v-if="config?.ready" size="small" type="success" effect="plain">{{ config.model }}</el-tag>
      <el-tag v-else size="small" type="warning" effect="plain">未配置模型</el-tag>
      <el-select v-model="promptId" size="small" class="ai-draw__prompt" placeholder="提示词">
        <el-option v-for="item in drawPrompts" :key="item.id" :label="item.title" :value="item.id" />
      </el-select>
    </div>

    <!-- 对话式入口就放在第一行：要多轮修改/自动点页面时用它，别在这里另造一套对话。 -->
    <el-button
      v-if="assistantReady"
      size="small"
      class="ai-draw__assistant"
      :icon="ChatDotRound"
      @click="openAssistant"
    >
      用页面助手对话改画布（顶栏 AI 图标）
    </el-button>

    <el-alert v-if="!draftable" type="info" :closable="false" show-icon
      title="打开一张画面后可用" description="AI 助手直接改当前画布，没有画布时不会调用模型。" />

    <template v-else>
      <div class="ai-draw__presets">
        <button v-for="preset in presets" :key="preset.label" type="button" @click="usePreset(preset.text)">
          {{ preset.label }}
        </button>
      </div>

      <el-input
        v-model="instruction"
        type="textarea"
        :rows="3"
        resize="none"
        placeholder="描述要画什么 / 要改哪里，例如：把三台泵排成一行，间距一致，标题靠左上"
      />

      <div class="ai-draw__actions">
        <el-button type="primary" :icon="MagicStick" :loading="loading" @click="generate">生成指令</el-button>
        <span class="ai-draw__hint">只改画布，不会自动保存</span>
      </div>

      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />

      <section v-if="result" class="ai-draw__result">
        <header>
          <strong>{{ result.applied.length }} 条待应用指令</strong>
          <small>{{ result.elapsedMs }}ms · {{ result.model }}</small>
        </header>

        <ul class="ai-draw__applied">
          <li v-for="(line, index) in result.applied" :key="index">{{ line }}</li>
        </ul>

        <el-alert
          v-for="issue in errorIssues"
          :key="`e-${issue.line}-${issue.message}`"
          type="error"
          :closable="false"
          show-icon
          :title="`第 ${issue.line} 行：${issue.message}`"
        />
        <el-alert
          v-for="issue in warnIssues"
          :key="`w-${issue.line}-${issue.message}`"
          type="warning"
          :closable="false"
          show-icon
          :title="`第 ${issue.line} 行：${issue.message}`"
        />

        <div class="ai-draw__actions">
          <el-button type="primary" :icon="Promotion" :disabled="result.applied.length === 0" @click="apply">
            应用到画布
          </el-button>
          <el-button text @click="result = null">放弃</el-button>
          <el-button text @click="showRaw = !showRaw">{{ showRaw ? '隐藏指令' : '查看指令' }}</el-button>
        </div>

        <pre v-if="showRaw" class="ai-draw__raw">{{ result.commands }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ai-draw { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
.ai-draw__head { display: flex; align-items: center; gap: 8px; }
.ai-draw__prompt { flex: 1; min-width: 0; }
.ai-draw__assistant { width: 100%; justify-content: center; }
.ai-draw__presets { display: flex; flex-wrap: wrap; gap: 6px; }
.ai-draw__presets button {
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  font-size: 12px; padding: 4px 9px; border-radius: 999px; cursor: pointer;
}
.ai-draw__presets button:hover { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
.ai-draw__actions { display: flex; align-items: center; gap: 8px; }
.ai-draw__hint { color: var(--muted); font-size: 11px; }
.ai-draw__result { display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--line); padding-top: 10px; }
.ai-draw__result header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ai-draw__result header strong { font-size: 13px; color: var(--app-text); }
.ai-draw__result header small { color: var(--muted); font-size: 11px; }
.ai-draw__applied { margin: 0; padding-left: 16px; color: var(--muted); font-size: 12px; line-height: 1.9; max-height: 140px; overflow: auto; }
.ai-draw__raw { margin: 0; padding: 10px; border-radius: 8px; background: var(--surface-soft); color: var(--app-text); font-size: 11px; line-height: 1.7; overflow: auto; max-height: 220px; white-space: pre-wrap; }
</style>
