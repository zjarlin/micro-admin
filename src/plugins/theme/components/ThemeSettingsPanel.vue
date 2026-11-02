<script setup lang="ts">
// 外观主题设置区：颜色/圆角/密度的可视化配置 + AI 生成 + 实时预览。
//
// 它是「自定义设置面板」的样板：这类交互（改一个色值立即预览）不适合声明式字段，
// 因此整块由插件自渲染、自保存；系统设置页只提供标题与外层定位。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick, Refresh } from '@element-plus/icons-vue'
import { useRuntime, useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useUiStore } from '@/stores/ui'
import {
  cloneTheme,
  defaultTheme,
  ensureReadable,
  followBrand,
  saveTheme,
  sidebarTokens,
  applyTheme,
  SIDEBAR_MODES,
  THEME_SCALAR_KEYS,
  type SidebarMode,
  type SidebarPalette,
  type ThemeResponse,
  type UiDensity,
  type UiTheme,
} from '@/shared/theme'

const http = useService<HttpClient>('http')
const runtime = useRuntime()
const ui = useUiStore()
// AI 是独立插件：被禁用时只是少一个加速入口，主题本身仍可手工调。
const aiEnabled = runtime.pluginEnabled('ai')

const theme = reactive<UiTheme>(defaultTheme())
const saved = ref<UiTheme>(defaultTheme())
const loading = ref(false)
const saving = ref(false)

const dirty = computed(() => JSON.stringify(theme) !== JSON.stringify(saved.value))

const colorFields: Array<{ key: keyof UiTheme; label: string; hint: string }> = [
  { key: 'brand', label: '主色', hint: '按钮、选中态、强调线' },
  { key: 'brandSoft', label: '主色浅底', hint: '选中背景、标签页' },
  { key: 'accent', label: '辅助色', hint: '渐变、图表第二色' },
  { key: 'appBg', label: '页面背景', hint: '内容区底色（深色模式下不生效）' },
  { key: 'surface', label: '卡片底色', hint: '面板、表格背景（深色模式下不生效）' },
  { key: 'text', label: '正文色', hint: '标题与正文（深色模式下不生效）' },
  { key: 'muted', label: '次要文字', hint: '说明文字与占位' },
]

// 侧栏是独立的一块：浅色 / 深色各一组，只放 5 个真的会调的色，其余由 sidebarTokens() 派生。
const sidebarMode = ref<SidebarMode>('light')
const sidebarKey = computed(() => SIDEBAR_MODES.find((item) => item.value === sidebarMode.value)!.key)
const palette = computed<SidebarPalette>(() => theme[sidebarKey.value])
const sidebarFields: Array<{ key: keyof SidebarPalette; label: string; hint: string }> = [
  { key: 'bg', label: '底色', hint: '整块导航的背景' },
  { key: 'text', label: '菜单文字', hint: '未选中条目' },
  { key: 'activeBg', label: '选中底色', hint: '当前页面那一条的底' },
  { key: 'activeText', label: '选中文字', hint: '当前页面那一条的字' },
  { key: 'activeBar', label: '强调条 / 角标', hint: '左侧细条与数量角标' },
]

/** 预览用的是同一套派生结果，和真实侧栏一像素不差。 */
const sidebarPreview = computed<Record<string, string>>(() => sidebarTokens(palette.value))

const densities: Array<{ value: UiDensity; label: string; hint: string }> = [
  { value: 'compact', label: '紧凑', hint: '信息密度高，适合监控大屏旁的后台' },
  { value: 'cozy', label: '标准', hint: '若依式默认留白' },
  { value: 'comfortable', label: '宽松', hint: '字段少、阅读优先的页面' },
]

function preview(): void {
  applyTheme(cloneTheme(theme), ui.dark)
}

function setColor(key: keyof UiTheme, value: string | null): void {
  if (typeof value !== 'string') return
  const previousBrand = theme.brand
  ;(theme as unknown as Record<string, unknown>)[key] = value
  if (key === 'brand') followBrand(theme, previousBrand)
  preview()
}

function setSidebarColor(key: keyof SidebarPalette, value: string | null): void {
  if (typeof value !== 'string') return
  palette.value[key] = value
  // 换底色/选中底时兜一次对比度：底调深了字不会留在深灰。手动调字之后不再覆盖。
  if (key === 'bg' || key === 'activeBg') {
    const fixed = ensureReadable(palette.value)
    if (fixed) ElMessage.info('底色调深了，文字已自动调亮（可再手动改）')
  }
  preview()
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const response = await http.request<ThemeResponse>('/ui/theme')
    Object.assign(theme, cloneTheme(response.theme))
    saved.value = cloneTheme(theme)
    preview()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取主题失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function publish(): Promise<void> {
  saving.value = true
  try {
    const next = await saveTheme(http, cloneTheme(theme))
    Object.assign(theme, cloneTheme(next))
    saved.value = cloneTheme(next)
    preview()
    ElMessage.success('已发布，所有人刷新后看到新外观')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败，检查是否有 system:theme:config 权限')
  } finally {
    saving.value = false
  }
}

function resetAll(): void {
  Object.assign(theme, defaultTheme())
  preview()
  ElMessage.info('已恢复默认外观，点「保存并发布」才会影响其他人')
}

// ---------------- AI 生成 ----------------
const aiVisible = ref(false)
const aiPrompt = ref('')
const aiLoading = ref(false)

function openAi(): void {
  aiVisible.value = true
  if (!aiPrompt.value) aiPrompt.value = '偏工业监控风：深蓝灰主色，克制的圆角，信息密度偏高，适合值班室大屏旁边看'
}

async function generate(): Promise<void> {
  const prompt = aiPrompt.value.trim()
  if (!prompt) return
  aiLoading.value = true
  try {
    const result = await http.request<{ tokens: Partial<UiTheme>; model: string }>('/ai/theme', {
      method: 'POST',
      body: JSON.stringify({ prompt, baseline: JSON.stringify(saved.value) }),
    })
    const tokens = result.tokens ?? {}
    const previousBrand = theme.brand
    for (const key of THEME_SCALAR_KEYS) {
      const value = tokens[key]
      if (value === undefined || value === null) continue
      ;(theme as unknown as Record<string, unknown>)[key] = value
    }
    followBrand(theme, previousBrand)
    preview()
    aiVisible.value = false
    ElMessage.success(`已生成预览（${result.model}），满意再保存发布`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生成失败')
  } finally {
    aiLoading.value = false
  }
}
</script>

<template>
  <div class="theme-panel" v-loading="loading">
    <div class="theme-toolbar">
      <el-tag v-if="dirty" type="warning" effect="plain">有未发布的改动</el-tag>
      <el-tag v-else type="success" effect="plain">与线上一致</el-tag>
      <div class="theme-toolbar__actions">
        <el-button v-if="aiEnabled" :icon="MagicStick" @click="openAi">AI 生成</el-button>
        <el-button :icon="Refresh" @click="resetAll">恢复默认</el-button>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="publish">保存并发布</el-button>
      </div>
    </div>

    <div class="theme-grid">
      <section class="panel">
        <div class="panel-title">
          <h2>颜色</h2>
          <span>十六进制，点色块可直接取色</span>
        </div>
        <div class="theme-rows">
          <div v-for="field in colorFields" :key="field.key" class="theme-row">
            <div class="theme-row__label">
              <span>{{ field.label }}</span>
              <small>{{ field.hint }}</small>
            </div>
            <el-input
              :model-value="String(theme[field.key])"
              class="theme-row__hex"
              @update:model-value="(value: string) => setColor(field.key, value)"
            />
            <el-color-picker
              :model-value="String(theme[field.key])"
              @update:model-value="(value: string | null) => setColor(field.key, value)"
            />
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>形状与密度</h2>
          <span>影响面板圆角、留白与表格行高</span>
        </div>
        <div class="theme-block">
          <label class="theme-block__label">圆角 <b>{{ theme.radius }}px</b></label>
          <el-slider
            :model-value="theme.radius"
            :min="0"
            :max="20"
            :step="1"
            show-stops
            @update:model-value="(value: number | number[]) => { theme.radius = Number(Array.isArray(value) ? value[0] : value); preview() }"
          />
        </div>
        <div class="theme-block">
          <label class="theme-block__label">内容密度</label>
          <div class="theme-densities">
            <button
              v-for="item in densities"
              :key="item.value"
              type="button"
              class="theme-density"
              :class="{ 'is-active': theme.density === item.value }"
              @click="theme.density = item.value; preview()"
            >
              <span>{{ item.label }}</span>
              <small>{{ item.hint }}</small>
            </button>
          </div>
        </div>
        <p class="theme-tip">
          深色模式由右上角的主题切换控制，这里的背景/正文色只在浅色模式生效；
          品牌色与圆角在两种模式下都生效。
        </p>
      </section>

      <section class="panel theme-sidebar">
        <div class="panel-title">
          <h2>侧栏调色板</h2>
          <span>浅色 / 深色各一套；右边就是这一套的真实效果</span>
        </div>
        <div class="theme-sidebar__body">
          <div class="theme-sidebar__editor">
            <div class="theme-modes">
              <button
                v-for="item in SIDEBAR_MODES"
                :key="item.value"
                type="button"
                class="theme-mode"
                :class="{ 'is-active': sidebarMode === item.value }"
                @click="sidebarMode = item.value"
              >
                {{ item.label }}模式
              </button>
            </div>
            <div class="theme-rows">
              <div v-for="field in sidebarFields" :key="field.key" class="theme-row">
                <div class="theme-row__label">
                  <span>{{ field.label }}</span>
                  <small>{{ field.hint }}</small>
                </div>
                <el-input
                  :model-value="palette[field.key]"
                  class="theme-row__hex"
                  @update:model-value="(value: string) => setSidebarColor(field.key, value)"
                />
                <el-color-picker
                  :model-value="palette[field.key]"
                  @update:model-value="(value: string | null) => setSidebarColor(field.key, value)"
                />
              </div>
            </div>
            <p class="theme-tip">
              分隔线、悬停底、次要文字、角标都由这几个色算出来，不用逐个填。
              选中条与选中文字默认跟主色走：改主色时它们一起变，手动调过之后就不再联动。
            </p>
          </div>

          <div class="sb-demo" :style="sidebarPreview">
            <div class="sb-demo__brand"><i class="sb-demo__logo" /><strong>微内核后台</strong></div>
            <div class="sb-demo__group">运行监控</div>
            <div class="sb-demo__item"><span>总览看板</span></div>
            <div class="sb-demo__item is-active"><span>设备台账</span><b class="sb-demo__badge">12</b></div>
            <div class="sb-demo__item"><span>画面库</span></div>
            <div class="sb-demo__group">系统</div>
            <div class="sb-demo__item"><span>用户与权限</span></div>
            <div class="sb-demo__foot">v1.4.0 · 已连接</div>
          </div>
        </div>
      </section>

      <section class="panel theme-preview">
        <div class="panel-title">
          <h2>实时预览</h2>
          <span>下面的组件用的就是当前 token</span>
        </div>
        <div class="theme-preview__stage">
          <div class="theme-preview__head">
            <strong>污水处理 · 实时看板</strong>
            <span class="theme-preview__badge">运行中</span>
          </div>
          <div class="theme-preview__actions">
            <el-button type="primary" size="small">新增画面</el-button>
            <el-button size="small">导出</el-button>
          </div>
          <div class="theme-preview__table">
            <div class="theme-preview__tr theme-preview__tr--head"><span>设备</span><span>状态</span><span>压力</span></div>
            <div class="theme-preview__tr"><span>1# 循环泵</span><span class="ok">运行</span><span>0.42 MPa</span></div>
            <div class="theme-preview__tr"><span>2# 循环泵</span><span class="warn">待机</span><span>0.00 MPa</span></div>
          </div>
        </div>
      </section>
    </div>

    <el-dialog v-model="aiVisible" title="AI 生成外观" width="560px">
      <el-input
        v-model="aiPrompt"
        type="textarea"
        :rows="4"
        placeholder="描述你想要的界面气质，例如：政务风、蓝色主色、方正一点、信息密度高"
      />
      <p class="theme-tip">模型只返回颜色/圆角/密度这些 token；生成结果先预览，确认后再发布。</p>
      <template #footer>
        <el-button @click="aiVisible = false">取消</el-button>
        <el-button type="primary" :loading="aiLoading" @click="generate">生成预览</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.theme-panel { display: flex; flex-direction: column; gap: 14px; }
.theme-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.theme-toolbar__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.theme-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 16px; align-items: start; }
.theme-preview { grid-column: 1 / -1; }
.theme-sidebar { grid-column: 1 / -1; }
.theme-sidebar__body { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .7fr); gap: 18px; align-items: start; }
.theme-sidebar__editor { display: flex; flex-direction: column; gap: 12px; }
.theme-modes { display: inline-flex; gap: 4px; padding: 3px; width: fit-content; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line); }
.theme-mode { padding: 5px 14px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; }
.theme-mode.is-active { background: var(--surface); color: var(--brand); box-shadow: 0 1px 3px rgba(15, 23, 42, .12); }
.sb-demo {
  display: flex; flex-direction: column; gap: 2px; min-height: 248px; padding: 12px 10px 10px;
  border-radius: 12px; border: 1px solid var(--sidebar-line);
  background: var(--sidebar-bg); color: var(--sidebar-text);
}
.sb-demo__brand { display: flex; align-items: center; gap: 8px; padding: 4px 8px 12px; font-size: 13px; color: var(--sidebar-text-strong); }
.sb-demo__logo { width: 18px; height: 18px; border-radius: 6px; background: var(--sidebar-active-bar); }
.sb-demo__group { padding: 10px 8px 4px; font-size: 10px; letter-spacing: .08em; color: var(--sidebar-muted); }
.sb-demo__item { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 8px 7px 13px; border-radius: 8px; font-size: 12px; color: var(--sidebar-text); }
.sb-demo__item.is-active { background: var(--sidebar-active-bg); color: var(--sidebar-active-text); }
.sb-demo__item.is-active span { font-weight: 600; }
.sb-demo__item.is-active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px;
  border-radius: 0 3px 3px 0; background: var(--sidebar-active-bar);
}
.sb-demo__badge { padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 600; background: var(--sidebar-badge-bg); color: var(--sidebar-badge-text); }
.sb-demo__foot { margin-top: auto; padding: 10px 8px 2px; font-size: 10px; color: var(--sidebar-muted); border-top: 1px solid var(--sidebar-line); }
.theme-rows { display: flex; flex-direction: column; gap: 10px; }
.theme-row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 34px; align-items: center; gap: 10px; }
.theme-row__label { display: flex; flex-direction: column; gap: 2px; }
.theme-row__label span { font-size: 13px; color: var(--app-text); }
.theme-row__label small { font-size: 11px; color: var(--muted); }
.theme-row__hex :deep(input) { font-family: ui-monospace, monospace; font-size: 12px; }
.theme-block + .theme-block { margin-top: 20px; }
.theme-block__label { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--app-text); margin-bottom: 6px; }
.theme-block__label b { color: var(--brand); }
.theme-densities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.theme-density {
  display: flex; flex-direction: column; gap: 4px; text-align: left; cursor: pointer;
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--app-text);
}
.theme-density small { color: var(--muted); font-size: 11px; line-height: 1.6; }
.theme-density.is-active { border-color: var(--brand); background: var(--brand-soft); }
.theme-tip { margin: 14px 0 0; font-size: 12px; line-height: 1.8; color: var(--muted); }
.theme-preview__stage { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-soft); padding: 16px; }
.theme-preview__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.theme-preview__head strong { font-size: 14px; color: var(--app-text); }
.theme-preview__badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--brand-soft); color: var(--brand); }
.theme-preview__actions { display: flex; gap: 8px; margin: 12px 0; }
.theme-preview__table { border-radius: calc(var(--radius) - 4px); overflow: hidden; background: var(--surface); border: 1px solid var(--line); }
.theme-preview__tr { display: grid; grid-template-columns: 1.4fr .8fr .8fr; gap: 8px; padding: 9px 12px; font-size: 12px; color: var(--app-text); }
.theme-preview__tr + .theme-preview__tr { border-top: 1px solid var(--line); }
.theme-preview__tr--head { background: var(--surface-soft); color: var(--muted); }
.theme-preview__tr .ok { color: #12b76a; }
.theme-preview__tr .warn { color: #f79009; }
@media (max-width: 1000px) { .theme-grid { grid-template-columns: 1fr; } .theme-sidebar__body { grid-template-columns: 1fr; } }
</style>
