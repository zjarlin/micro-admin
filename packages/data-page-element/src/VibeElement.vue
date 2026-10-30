<!-- 活元素运行时：模板片段 + 数据 + 处理器 → 真实组件。
     设计器与线上页面共用这一个实现，所以「预览里长什么样」就是「上线后长什么样」。

     渲染走 Vue 运行期编译器（`vue/dist/vue.esm-bundler.js`，按需加载 ~90KB），
     因此模板能随 schema 下发、改一处即时重渲染——这就是 vibecoding 的实时性来源。
     安全边界在发布时由编译器的 `inspectCode` 把关；运行期只多守一道：
     编译失败或运行期抛错都降级成提示，不让整页白屏。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Row, VibeSchema } from '@zjarlin/data-page'
import { vibeScopeData } from '@zjarlin/data-page'
import { vibeHandlerName } from '@zjarlin/data-page/vibe'
import type { VibeHandler } from './vibe'

type RenderFn = (context: Record<string, unknown>) => unknown
type Compiler = (template: string, options?: Record<string, unknown>) => RenderFn

let compilerPromise: Promise<Compiler> | null = null
function loadCompiler(): Promise<Compiler> {
  compilerPromise ??= import('vue/dist/vue.esm-bundler.js').then(
    (module) => (module as unknown as { compile: Compiler }).compile,
  )
  return compilerPromise
}

const props = defineProps<{
  /** 元素级模板与绑定（schema 里的 `vibe`）。 */
  vibe: VibeSchema
  /** 槽位取值：`value` / `row` / `label` / `options` … */
  data?: Row | undefined
  /** 通道名 → 处理器；模板里以 `onClick` / `onChange` 出现。 */
  handlers?: Record<string, VibeHandler> | undefined
}>()

const error = ref<string | null>(null)
const render = ref<RenderFn | null>(null)

const code = computed(() => props.vibe.code.trim())

async function build(): Promise<void> {
  error.value = null
  if (!code.value) {
    render.value = null
    return
  }
  try {
    const compile = await loadCompiler()
    render.value = compile(code.value, { mode: 'function', hoistStatic: false })
  } catch (cause) {
    render.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(code, () => void build(), { immediate: true })

/** 模板能看到的全部名字：槽位取值 + 通道值（数据绑定）+ 事件方法。 */
const scope = computed<Record<string, unknown>>(() => {
  const scoped: Record<string, unknown> = vibeScopeData(props.vibe, props.data ?? {})
  for (const [channel, handler] of Object.entries(props.handlers ?? {})) {
    scoped[vibeHandlerName(channel)] = (payload?: unknown) => handler(payload)
  }
  return scoped
})

/**
 * 把编译结果包成「一次性组件」再交给 Vue 渲染。
 *
 * 不能手工调用渲染函数：编译产物里的 `_resolveComponent('el-button')` 依赖
 * currentRenderingInstance 才能查到全局组件，手工调用时它是 null，`el-*` 会悄悄
 * 退化成惰性自定义标签——看着渲染了，其实没有组件行为。
 */
const snippet = computed<{ name: string; render: () => unknown } | null>(() => {
  const renderFn = render.value
  if (!renderFn || error.value) return null
  const values = scope.value
  return {
    name: 'VibeElementSnippet',
    render: () => {
      try {
        return renderFn(values)
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause)
        return null
      }
    },
  }
})
</script>

<template>
  <div class="vibe-element">
    <el-alert
      v-if="error"
      type="error"
      :closable="false"
      show-icon
      :title="`模板无法渲染：${error}`"
    />
    <component :is="snippet" v-else-if="snippet" />
  </div>
</template>

<style scoped>
/* 单元格里的活元素按内容宽度排布，不撑破列宽。 */
.vibe-element { min-width: 0; max-width: 100%; }
.vibe-element :deep(.vibe-stat) { display: flex; flex-direction: column; gap: 4px; }
.vibe-element :deep(.vibe-stat__label) { color: var(--muted); font-size: 12px; }
.vibe-element :deep(.vibe-text) { margin: 0; }
</style>
