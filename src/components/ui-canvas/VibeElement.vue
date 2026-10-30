<!-- vibeelement 运行时：把「模板片段 + 数据绑定 + 事件绑定」渲染成真实元素。
     渲染走 Vue 运行期编译器（`vue/dist/vue.esm-bundler.js`），因此改模板即时重渲染——
     这正是 vibecoding 的实时性来源，而不是每次改都要起构建。
     安全边界由 `@zjarlin/ui-canvas` 的 `inspectCode` 与 `validateBindings` 保证：
     组件只把白名单里的数据通道与已注册的处理器暴露给模板，模板拿不到 http/router/store。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { handlerNamesOf, inspectCode, type UiElement, type VibeElementModel } from '@/shared/ui-canvas'

/**
 * Vue 完整构建（含模板编译器）按需加载：只有页面里真的用到 vibeelement 模板时才付
 * 这 ~90KB 的代价，普通页面不受影响。因此是 `import()` 而不是顶层 import。
 */
type Compiler = (template: string, options?: Record<string, unknown>) => (context: Record<string, unknown>) => unknown

let compilerPromise: Promise<Compiler> | null = null
async function loadCompiler(): Promise<Compiler> {
  compilerPromise ??= import('vue/dist/vue.esm-bundler.js').then(
    (module) => (module as unknown as { compile: Compiler }).compile,
  )
  return compilerPromise
}

const props = defineProps<{
  element: UiElement
  model: VibeElementModel
  /** 事件处理器：通道名 → 宿主定义的函数。 */
  handlers: Record<string, (payload?: unknown) => void>
  /** 模板里的额外上下文（label / value / series …）。 */
  context: Record<string, unknown>
}>()

/** 编译失败时降级成提示，而不是让整页白屏。 */
const error = ref<string | null>(null)
const render = ref<((context: Record<string, unknown>) => unknown) | null>(null)

const code = computed(() => props.model.code.trim())

const issues = computed(() => inspectCode(code.value))

/**
 * 编译模板。
 *
 * `compile` 来自 Vue 的完整构建（带运行期编译器）：传进来的 `context` 作为组件
 * 渲染作用域的根，因此模板里只出现 context 上的键——也就是数据通道值与处理器名，
 * 模板自身没有能力访问模块作用域。
 */
async function build(): Promise<void> {
  error.value = null
  if (!code.value) {
    render.value = null
    return
  }
  const blocking = issues.value.filter((issue) => issue.level === 'error')
  if (blocking.length) {
    render.value = null
    error.value = blocking[0]?.message ?? '模板不合法'
    return
  }
  try {
    const compile = await loadCompiler()
    // 返回的是渲染函数，参数是渲染上下文（即下面的 scope）。
    render.value = compile(code.value, { mode: 'function', hoistStatic: false })
  } catch (cause) {
    render.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(code, () => void build(), { immediate: true })

/** 数据与事件一次装配：模板里只看到这些键。 */
const scope = computed<Record<string, unknown>>(() => {
  const names = handlerNamesOf(props.element)
  const scoped: Record<string, unknown> = {
    ...props.context,
    ...props.model.data,
    label: props.context.label ?? props.model.label,
    value: props.context.value ?? props.model.data.value,
  }
  for (const [channel, name] of Object.entries(names)) {
    scoped[name] = (payload?: unknown) => props.handlers[channel]?.(payload)
  }
  return scoped
})

/**
 * 把编译结果包成一个「一次性组件」，再交给 Vue 正常渲染。
 *
 * 不能手工调用渲染函数：编译产物里 `_resolveComponent('el-button')` 要靠 Vue 的
 * currentRenderingInstance 才能查到全局组件，手工调用时它是 null，`el-*` 会悄悄退化成
 * 惰性的 `<el-button>` 自定义标签——看着渲染了，其实没有组件行为。交给 Vue 之后
 * 组件解析、patch、指令、事件全部走正常链路。
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
        // 模板能编译但运行期炸了（例如访问了不存在的字段）时，降级成提示而不是白屏。
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
    <span v-else class="muted">（该元素没有模板片段，按角色默认样式渲染）</span>
  </div>
</template>

<style scoped>
.vibe-element { min-width: 0; }
.vibe-element :deep(.vibe-stat) { display: flex; flex-direction: column; gap: 4px; }
.vibe-element :deep(.vibe-stat__label) { color: var(--muted); font-size: 12px; }
.vibe-element :deep(.vibe-text) { margin: 0; }
</style>
