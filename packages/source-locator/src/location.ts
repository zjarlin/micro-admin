// 源位置的基础契约：一个 DOM 元素「来自哪个文件的第几行第几列」。
//
// 编译期写进属性、运行期读取，两者共用这一个形状；
// 因此包本身不认 Vue 组件、不认路由、不认任何业务符号，任何前端都能用。

/** 编译期写进 DOM 的属性名；拾取器按它反查源位置。 */
export const SOURCE_ATTRIBUTE = 'data-source-loc'

/** 仓库内相对路径 + 1 基行列（与编辑器 CLI 的 `file:line:column` 一致）。 */
export interface SourceLocation {
  file: string
  line: number
  column: number
}

/** 组件链上的一帧：谁渲染了这块 DOM。 */
export interface ComponentFrame {
  /** 仓库内相对路径；解析不出来时为 null（例如第三方组件）。 */
  file: string | null
  /** 组件名；取不到时回落为文件名。 */
  name: string
  /** 是否是本项目（非 node_modules）的组件。 */
  local: boolean
}

/** 一次拾取的结果：命中的 DOM 元素 + 它的源位置 + 到顶层的组件链。 */
export interface PickedElement {
  element: Element
  location: SourceLocation | null
  chain: ComponentFrame[]
}

/** `src/a.vue:12:3` → `{ file, line, column }`；不合法返回 null。 */
export function parseLocation(text: string | null | undefined): SourceLocation | null {
  if (!text) return null
  const match = text.match(/^(.*):(\d+):(\d+)$/)
  if (!match) return null
  const [, file, line, column] = match
  if (!file || !line || !column) return null
  return { file, line: Number(line), column: Number(column) }
}

/** 统一成 `file:line:column`（复制给同事或粘进编辑器都能直接用）。 */
export function formatLocation(location: SourceLocation): string {
  return `${location.file}:${location.line}:${location.column}`
}

/** 从元素自身或最近的祖先读源位置：文本节点落在元素内也能定位到所属标签。 */
export function locateElement(element: Element, attribute: string = SOURCE_ATTRIBUTE): SourceLocation | null {
  const host = element.closest(`[${attribute}]`)
  if (!host) return null
  return parseLocation(host.getAttribute(attribute))
}

/** 路径归一：统一分隔符、去掉 `./`；不做任何「猜目录」的动作。 */
export function normalizeFile(file: string | undefined): string | null {
  if (!file) return null
  const slash = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return slash || null
}

/**
 * 把 `__file` 还原成仓库内相对路径。
 *
 * Vue 在三处给出的形态不同：
 * - 开发构建：绝对路径（`/opt/proj/src/x.vue`）；
 * - 生产构建：只留 basename（`x.vue`）；
 * - 编译期注入的属性：本来就是相对路径（`src/x.vue`）。
 * 因此统一交给清单做「最长后缀匹配」：既不需要知道项目根，也不会把 x.vue 猜错目录。
 */
export interface FileResolver {
  /** 输入任意形态的路径，输出仓库内相对路径；对不上返回 null。 */
  (file: string): string | null
  /** 同一 basename 命中多个文件时的候选，用于提示歧义。 */
  candidates(file: string): string[]
}

export function createFileResolver(files: readonly string[]): FileResolver {
  const known = new Set(files)
  const byName = new Map<string, string[]>()
  for (const file of files) {
    const name = file.split('/').pop()
    if (!name) continue
    const bucket = byName.get(name)
    if (bucket) bucket.push(file)
    else byName.set(name, [file])
  }

  const suffixes = (file: string): string[] => {
    const parts = normalizeFile(file)?.split('/') ?? []
    const out: string[] = []
    for (let index = 0; index < parts.length; index += 1) out.push(parts.slice(index).join('/'))
    return out
  }

  const resolver = ((file: string): string | null => {
    for (const suffix of suffixes(file)) {
      if (known.has(suffix)) return suffix
    }
    const name = normalizeFile(file)?.split('/').pop()
    return name ? byName.get(name)?.[0] ?? null : null
  }) as FileResolver

  resolver.candidates = (file: string): string[] => {
    for (const suffix of suffixes(file)) {
      if (known.has(suffix)) return [suffix]
    }
    const name = normalizeFile(file)?.split('/').pop()
    return name ? byName.get(name) ?? [] : []
  }
  return resolver
}

/**
 * 组件链上的 props（由内到外）。
 *
 * 用途：配置驱动的页面把「这一页是哪个 schema」写在 `SchemaPage` 的 props 里，
 * 只有拿到 props 才能把「渲染壳」补成「页面定义在哪里」。
 */
export function instanceProps(element: Element, limit = 8): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<VueInstance>()
  let instance = instanceOf(element)
  while (instance && out.length < limit && !seen.has(instance)) {
    seen.add(instance)
    const props = (instance as unknown as { props?: unknown }).props
    if (typeof props === 'object' && props !== null) out.push(props as Record<string, unknown>)
    instance = asInstance(instance.parent)
  }
  return out
}

/** 同一 basename 对应的全部源码文件（生产构建压成 basename 时用来提示歧义）。 */
export function filesNamed(files: readonly string[], basename: string): string[] {
  return files.filter((file) => file === basename || file.endsWith(`/${basename}`))
}

/** Vue 实例的最小形状：只取「谁渲染的」用得到的三处字段。 */
interface VueInstance {
  type?: { __file?: string; name?: string; __name?: string } | null
  parent?: VueInstance | null
  vnode?: { type?: { __file?: string; name?: string; __name?: string } } | null
}

function asInstance(value: unknown): VueInstance | null {
  return typeof value === 'object' && value !== null ? (value as VueInstance) : null
}

function instanceOf(element: Element): VueInstance | null {
  const holder = element as unknown as Record<string, unknown>
  // Vue 挂载时懒定义 `__vueParentComponent`：dev 构建或开了 prod devtools 才有。
  return asInstance(holder['__vueParentComponent'])
}

export interface ChainOptions {
  /** 路径还原器（通常来自 `createFileResolver`）；不给就只做归一化。 */
  resolve?: FileResolver
  /** 最多向上走多少层，防止异常链死循环。 */
  limit?: number
}

/**
 * 组件链：从承载 DOM 的实例一路向上，回答「这一块是谁渲染的」。
 *
 * 由内到外返回，调用方可以直接把最后一项当页面组件。
 */
export function componentChain(element: Element, options: ChainOptions = {}): ComponentFrame[] {
  const limit = options.limit ?? 24
  const frames: ComponentFrame[] = []
  const seen = new Set<VueInstance>()
  let instance = instanceOf(element)
  while (instance && frames.length < limit && !seen.has(instance)) {
    seen.add(instance)
    const type = instance.type ?? instance.vnode?.type ?? null
    const resolved = type?.__file ? (options.resolve?.(type.__file) ?? normalizeFile(type.__file)) : null
    const named = type?.name || type?.__name
    frames.push({
      file: resolved,
      name: named || (resolved ? resolved.split('/').pop()?.replace(/\.vue$/, '') ?? resolved : 'Anonymous'),
      local: resolved !== null && !resolved.includes('node_modules/'),
    })
    instance = asInstance(instance.parent)
  }
  // 去掉「没有源码、也没有名字」的内建实现帧（过渡、Fragment 包装之类）：
  // 它们对「这块 DOM 写在哪」没有帮助，只会把真正的页面组件挤出前几位。
  const meaningful = frames.filter((frame) => frame.file !== null || frame.name !== 'Anonymous')
  return meaningful.length ? meaningful : frames
}
