<!-- CAD 图纸导入：丢一个 DXF / DWG 进来，服务端解析成绘图指令集，再决定要不要让 AI 补语义。
     DWG 的原始字节由服务端交给 libredwg 的 WASM；二进制 DXF 在选择文件时就按魔数拦下。
     三段都在服务端完成（解析 / 应用 / 语义补全），前端只做拖放、选项与预览，
     所以「导入的几何」和「AI 画的几何」走同一个执行器，不会出现两套坐标系。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import type { HttpClient } from '@/shared/http'
import type { ScadaDocument, ScadaSymbolDefinition, ScadaTagOption } from '@/shared/scada/types'
import { applyCad, importCad, refineCad, type CadImportView } from '@/shared/scada/cad-api'
import { detectCadFormat } from '@/shared/scada/cad'

const props = defineProps<{
  modelValue: boolean
  http: HttpClient
  document: ScadaDocument
  symbols: ScadaSymbolDefinition[]
  tags: ScadaTagOption[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** 应用后的文档：写回画布，由页面负责置 dirty（不自动保存）。 */
  (event: 'apply', document: ScadaDocument): void
}>()

/** 与服务端同一个上限：再大就是误传了别的文件。 */
const MAX_BYTES = 5 * 1024 * 1024
const PREVIEW_LINES = 18

const fileName = ref('')
const fileBytes = ref(0)
const base64 = ref('')
const parsing = ref(false)
const applying = ref(false)
const refining = ref(false)
const result = ref<CadImportView | null>(null)
const error = ref<string | null>(null)
const dragActive = ref(false)

/** 选项：目标画布尺寸、图层、最小图形尺寸。改任意一项都重新解析一次（本地解析不花钱）。 */
const canvasWidth = ref(1920)
const canvasHeight = ref(1080)
const minSize = ref(6)
const selectedLayers = ref<string[]>([])

const canvasPresets = [
  { label: '1920 × 1080（16:9）', value: '1920x1080' },
  { label: '1600 × 900', value: '1600x900' },
  { label: '1366 × 768', value: '1366x768' },
  { label: '2560 × 1440', value: '2560x1440' },
]

const canvasPreset = computed({
  get: () => `${canvasWidth.value}x${canvasHeight.value}`,
  set: (value: string) => {
    const [width, height] = value.split('x').map(Number)
    canvasWidth.value = width || 1920
    canvasHeight.value = height || 1080
  },
})

const previewLines = computed(() => {
  const commands = result.value?.commands ?? ''
  return commands.split('\n').slice(0, PREVIEW_LINES)
})
const commandLineCount = computed(() => (result.value?.commands.split('\n').length ?? 0))

/** 体积对比：源文件 → 指令 → 摘要，末尾给出倍率。这是「省 token」的实测依据。 */
const ratio = computed(() => {
  const source = result.value?.bytes.source ?? 0
  const commands = result.value?.bytes.commands ?? 0
  return source > 0 ? source / Math.max(commands, 1) : 0
})

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1048576).toFixed(1)} MB`
}

function reset(): void {
  fileName.value = ''
  fileBytes.value = 0
  base64.value = ''
  result.value = null
  error.value = null
  selectedLayers.value = []
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) reset()
  },
)

/** 读文件 → base64：统一按字节上传，编码（UTF-8 / GBK）由服务端判定。 */
async function loadFile(file: File): Promise<void> {
  if (file.size > MAX_BYTES) {
    error.value = `文件太大（${formatBytes(file.size)}），上限 5MB`
    return
  }
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // 按**字节**判格式，不看扩展名：`.dwg` 改名成 `.dxf`、浏览器给的 MIME 不准都很常见，
  // 扩展名对不上时若不拦，等传完 5MB 才在服务端报错。
  // DWG 现在**可以**直接导入（服务端走 libredwg 的 WASM），只有二进制 DXF 还要求转存。
  const format = detectCadFormat(bytes)
  if (format === 'binary-dxf') {
    error.value = '这是二进制 DXF：请在 CAD 里另存为 ASCII DXF 再导入'
    return
  }
  if (!/\.(dxf|dwg)$/i.test(file.name)) {
    error.value = `不支持的文件类型：${file.name}。请选择 .dxf 或 .dwg 文件`
    return
  }
  let binary = ''
  // 分块转 base64：一次性 `String.fromCharCode(...bytes)` 在 5MB 时会爆栈。
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  fileName.value = file.name
  fileBytes.value = file.size
  base64.value = btoa(binary)
  result.value = null
  error.value = null
  await parse()
}

function onDrop(event: DragEvent): void {
  dragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void loadFile(file)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void loadFile(file)
  input.value = ''
}

async function parse(): Promise<void> {
  if (!base64.value) return
  parsing.value = true
  error.value = null
  try {
    const view = await importCad(props.http, {
      fileName: fileName.value,
      content: base64.value,
      base64: true,
      options: {
        canvas: { width: canvasWidth.value, height: canvasHeight.value },
        minSize: minSize.value,
        ...(selectedLayers.value.length ? { layers: selectedLayers.value } : {}),
      },
    })
    result.value = view
    // 第一次解析后按「图纸里可见的图层」默认勾选，用户再手动增减。
    if (!selectedLayers.value.length) {
      selectedLayers.value = view.drawing.layers.filter((layer) => layer.visible).map((layer) => layer.name)
    }
  } catch (e) {
    result.value = null
    error.value = e instanceof Error ? e.message : '图纸解析失败'
  } finally {
    parsing.value = false
  }
}

/** 直接应用：只把指令落到当前画布（清空原有图元，图纸就是这张画面）。 */
async function applyOnly(): Promise<void> {
  if (!result.value) return
  applying.value = true
  try {
    const next = await applyCad(props.http, {
      document: { ...props.document, canvas: { ...props.document.canvas, width: canvasWidth.value, height: canvasHeight.value }, widgets: [] },
      commands: result.value.commands,
    })
    const errors = next.issues.filter((item) => item.severity === 'error')
    emit('apply', next.document)
    emit('update:modelValue', false)
    ElMessage.success(`已导入 ${next.applied.length} 条绘图指令${errors.length ? `（${errors.length} 条未通过校验）` : ''}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '应用失败')
  } finally {
    applying.value = false
  }
}

/** AI 补语义：先应用几何，再让模型读摘要换设备类型 / 接变量（只读摘要，不读 DXF）。 */
async function applyWithAi(): Promise<void> {
  if (!result.value) return
  refining.value = true
  let base: Awaited<ReturnType<typeof applyCad>> | null = null
  try {
    base = await applyCad(props.http, {
      document: { ...props.document, canvas: { ...props.document.canvas, width: canvasWidth.value, height: canvasHeight.value }, widgets: [] },
      commands: result.value.commands,
    })
    const refined = await refineCad(props.http, {
      prompt: '按图纸摘要把通用图元换成设备图元、接上能确定语义的变量、给占位名改成有意义的中文名称。不要移动位置、不要改画布尺寸。',
      digest: result.value.digest,
      document: base.document,
      symbols: props.symbols,
      tags: props.tags,
    })
    const errors = refined.issues.filter((item) => item.severity === 'error')
    emit('apply', refined.document)
    emit('update:modelValue', false)
    ElMessage.success(
      `图纸已导入并补全 ${refined.applied.length} 条语义指令${errors.length ? `（${errors.length} 条未通过校验）` : ''}，记得保存`,
    )
  } catch (e) {
    // 语义补全失败也要保住几何：图纸本身是本地解析出来的，不该因为模型超时白导一次。
    if (base) {
      emit('apply', base.document)
      emit('update:modelValue', false)
      ElMessage.warning(`AI 补语义失败（${e instanceof Error ? e.message : '未知错误'}），已先应用图纸几何；可稍后再用「页面助手」补语义`)
    } else {
      ElMessage.error(e instanceof Error ? e.message : 'AI 补语义失败')
    }
  } finally {
    refining.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="导入 CAD 图纸（DXF → 组态画面）"
    width="920px"
    top="5vh"
    append-to-body
    class="scada-cad-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="cad">
      <div
        class="cad-drop"
        :class="{ 'is-active': dragActive, 'is-loaded': Boolean(fileName) }"
        @dragover.prevent="dragActive = true"
        @dragleave="dragActive = false"
        @drop.prevent="onDrop"
      >
        <el-icon :size="26"><UploadFilled /></el-icon>
        <div class="cad-drop__text">
          <strong>{{ fileName || '把 .dxf / .dwg 图纸拖到这里，或点击选择文件' }}</strong>
          <span v-if="fileName">{{ formatBytes(fileBytes) }} · 已在服务端解析，本地不花 token</span>
          <span v-else>支持 DWG（R13~2018）与 ASCII DXF；二进制 DXF 请转存</span>
        </div>
        <label class="cad-drop__pick">
          <input type="file" accept=".dxf,.dwg" @change="onPick" />
          选择文件
        </label>
      </div>

      <div v-if="error" class="cad-error">{{ error }}</div>

      <div v-if="result" class="cad-options">
        <div class="cad-field">
          <span>目标画布</span>
          <el-select v-model="canvasPreset" size="small" style="width: 170px" @change="parse">
            <el-option v-for="item in canvasPresets" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>
        <div class="cad-field">
          <span>最小图形 {{ minSize }}px</span>
          <el-slider v-model="minSize" :min="2" :max="24" :step="1" size="small" style="width: 140px" @change="parse" />
        </div>
        <div class="cad-field cad-field--layers">
          <span>图层</span>
          <div class="cad-layers">
            <el-checkbox-group v-model="selectedLayers" size="small" @change="parse">
              <el-checkbox
                v-for="layer in result.drawing.layers"
                :key="layer.name"
                :value="layer.name"
                :label="`${layer.name}${layer.visible ? '' : '（关）'}`"
              />
            </el-checkbox-group>
          </div>
        </div>
      </div>

      <div v-if="result" class="cad-stats">
        <div class="cad-stat">
          <span>图纸</span>
          <strong>{{ result.drawing.stats.raw }} 实体</strong>
          <em>块 {{ result.drawing.stats.blocks }} · 展开 {{ result.drawing.stats.expanded }}</em>
        </div>
        <div class="cad-stat">
          <span>归类</span>
          <strong>{{ result.stats.used }} 图元</strong>
          <em>合并 {{ result.stats.merged }} 段 · 丢弃 {{ result.stats.dropped }}</em>
        </div>
        <div class="cad-stat">
          <span>指令</span>
          <strong>{{ commandLineCount }} 行</strong>
          <em>{{ result.canvas.width }}×{{ result.canvas.height }} · 缩放 {{ result.scale.toFixed(2) }} px/单位</em>
        </div>
        <div class="cad-stat cad-stat--bytes">
          <span>体积（省 token 的依据）</span>
          <strong>{{ formatBytes(result.bytes.source) }} → {{ formatBytes(result.bytes.commands) }}</strong>
          <em>摘要 {{ formatBytes(result.bytes.digest) }} · 指令约为源文件的 1/{{ Math.round(ratio) }}</em>
        </div>
      </div>

      <div v-if="result" class="cad-preview">
        <div class="cad-preview__head">
          <span>绘图指令（前 {{ Math.min(PREVIEW_LINES, commandLineCount) }} 行）</span>
          <span class="muted">类型：{{ Object.entries(result.stats.byKind).map(([key, count]) => `${key} ${count}`).join(' · ') }}</span>
        </div>
        <pre class="cad-preview__code">{{ previewLines.join('\n') }}</pre>
      </div>

      <div v-if="result?.warnings.length" class="cad-warnings">
        <span v-for="warning in result.warnings" :key="warning">{{ warning }}</span>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button :disabled="!result" :loading="applying" @click="applyOnly">直接应用</el-button>
      <span class="cad-footer-hint">AI 补语义读的是摘要（{{ result ? formatBytes(result.bytes.digest) : '—' }}），通常 30~90 秒</span>
      <el-button type="primary" :disabled="!result" :loading="refining" @click="applyWithAi">
        AI 补语义
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cad { display: flex; flex-direction: column; gap: 12px; max-height: 74vh; overflow: auto; }

.cad-drop {
  display: flex; align-items: center; gap: 12px; padding: 16px 18px;
  border: 1px dashed var(--line); border-radius: 10px; background: var(--surface-soft);
  color: var(--muted); transition: border-color .16s ease, background .16s ease;
}
.cad-drop.is-active { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.cad-drop.is-loaded { border-style: solid; }
.cad-drop__text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 auto; }
.cad-drop__text strong { font-size: 13px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cad-drop__text span { font-size: 11px; }
.cad-drop__pick {
  flex: none; padding: 5px 12px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--surface); color: var(--app-text); font-size: 12px; cursor: pointer;
}
.cad-drop__pick:hover { border-color: var(--brand); color: var(--brand); }
.cad-drop__pick input { display: none; }

.cad-error {
  padding: 8px 12px; border-radius: 8px; font-size: 12px;
  border: 1px solid color-mix(in srgb, #ef4444 45%, transparent);
  background: color-mix(in srgb, #ef4444 10%, transparent); color: #f87171;
}

.cad-options { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 12px; }
.cad-field { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.cad-field > span { white-space: nowrap; }
.cad-field--layers { flex: 1 1 100%; align-items: flex-start; }
.cad-layers { max-height: 88px; overflow: auto; padding-right: 4px; }
.cad-layers :deep(.el-checkbox) { margin-right: 12px; height: 22px; }

.cad-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.cad-stat {
  display: flex; flex-direction: column; gap: 2px; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: 9px; background: var(--surface);
}
.cad-stat span { font-size: 11px; color: var(--muted); }
.cad-stat strong { font-size: 14px; color: var(--app-text); font-variant-numeric: tabular-nums; }
.cad-stat em { font-style: normal; font-size: 11px; color: var(--muted); }
.cad-stat--bytes strong { color: var(--brand); }

.cad-preview { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.cad-preview__head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 11px; font-size: 11px; color: var(--muted); background: var(--surface-soft);
  border-bottom: 1px solid var(--line);
}
.cad-preview__code {
  margin: 0; padding: 10px 12px; max-height: 200px; overflow: auto;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--app-text); background: var(--surface); white-space: pre;
}
.cad-warnings { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #f59e0b; }
.muted { color: var(--muted); }
.cad-footer-hint { margin-right: 12px; font-size: 11px; color: var(--muted); }
</style>
