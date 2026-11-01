// 纯逻辑层：模板 AST → 元树。不依赖 vite、不依赖 Vue 运行时，可整体搬走复用。
//
// 三条硬规则（README「边界」逐条对应）：
// 1. 只有带 v-meta 的节点才会进元树；没有 v-meta 的节点全跳过，不存在第二种自动采集入口。
// 2. 组件标签（tagType === COMPONENT，含 el-*/a-*）是黑盒：标了就是单个叶节点，
//    没标的整棵子树都不采集；插件永远不打开业务组件自己的 .vue，也不展开它的内部。
// 3. 层归属由「最近的标记后代」决定：中间夹着的原生元素与 <template> 透明穿透，
//    这样 <el-row>/<el-col>/<template v-if> 这类包裹不会把子块孤立成另一个根。

/** 元树节点：字段与顺序即对外契约。 */
export interface MetaNode {
  metaId: string
  name: string
  desc: string
  group: string
  sourceFile: string
  tag: string
  children: MetaNode[]
}

/** 只声明本层会读写的字段，避免把编译器内部类型带进依赖。 */
export interface AstNode {
  type: number
  tag?: string
  tagType?: number
  props?: AstProp[]
  children?: AstNode[]
  /** v-if / v-else-if / v-else 分支；指令节点自身不带 props。 */
  branches?: AstNode[][]
  loc?: { start: { line: number; column: number } }
}

export interface AstProp {
  /** 6 = 普通属性，7 = 指令。 */
  type: number
  name?: string
  arg?: { content?: string } | null
  exp?: { content?: string } | null
  loc?: { start: { line: number; column: number } }
}

/** 编译器节点类型（只用到这几个）。 */
export const NodeType = { ROOT: 0, ELEMENT: 1, IF: 9, IF_BRANCH: 10, FOR: 11 } as const

/** 编译器 tagType：原生元素 / 组件 / 插槽 / 模板。 */
export const TagType = { ELEMENT: 0, COMPONENT: 1, SLOT: 2, TEMPLATE: 3 } as const

/** 采集标记指令名。 */
export const META_DIRECTIVE = 'meta'
/** 配套运行期指令名。 */
export const PERMISSION_META_DIRECTIVE = 'permission-meta'

/**
 * 底层组件前缀黑名单：默认不采集，也不会被下钻。
 *
 * 「只有写了 v-meta 才进树」是唯一采集入口，所以这里不需要额外拦截逻辑；
 * 它同时是「哪些标签算底层组件」的唯一判据，供下钻与告警使用。
 */
export const BASIC_COMPONENT_PREFIXES: readonly string[] = ['el-', 'a-']

/** 原生标签黑名单：默认不采集；显式写 v-meta 时按「页面就地区块」采集。 */
export const BASIC_NATIVE_TAGS: readonly string[] = [
  'div', 'span', 'button', 'input', 'p', 'label', 'a', 'img', 'i', 'b', 'u', 'em', 'strong',
  'small', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'ul', 'ol', 'li',
  'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'form', 'select', 'option',
  'textarea', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]

export function isBasicComponent(tag: string): boolean {
  const lower = tag.toLowerCase()
  return BASIC_COMPONENT_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

export function isBasicNativeTag(tag: string): boolean {
  return BASIC_NATIVE_TAGS.includes(tag.toLowerCase())
}

/** 组件标签：黑盒，既不下钻也不穿透。 */
export function isComponentTag(node: AstNode): boolean {
  return node.tagType === TagType.COMPONENT
}

/** 模板占位标签：不渲染真实 DOM，自身没法挂指令。 */
export function isTemplateTag(node: AstNode): boolean {
  return node.tagType === TagType.TEMPLATE || node.tag === 'template'
}

/** 页面就地区块的兜底 id：文件 + 文档序索引。 */
export function pageMetaId(sourceFile: string, index: number): string {
  return `page:${sourceFile}:${index}`
}

/** 独立业务 SFC 组件的兜底 id：组件自己的文件相对路径（同一组件全站共用一个 id）。 */
export function bizMetaId(componentFile: string): string {
  return `biz:${componentFile}`
}

/** `行:列` 键，1 基，与本插件写入的 sourceFile 使用同一套坐标。 */
export function locKey(line: number, column: number): string {
  return `${line}:${column}`
}

/** 采集到的标记节点。 */
export interface MarkedHit {
  node: AstNode
  /** v-meta:id="…"；优先级最高。 */
  explicitId?: string
  /** v-meta="{ name, desc, group }" 里读到的字面量字段。 */
  fields: Record<string, string>
  /** 同一节点上的 v-permission-meta 指令。 */
  permissionProps: AstProp[]
  /** 采集告警（不阻断构建）。 */
  issues: string[]
}

function directivesOf(node: AstNode): AstProp[] {
  return (node.props ?? []).filter((prop) => prop.type === 7)
}

function directivesNamed(node: AstNode, name: string): AstProp[] {
  return directivesOf(node).filter((prop) => prop.name === name)
}

/**
 * 文档序遍历：把带 v-meta 的节点按序交给 visit。
 *
 * 顺序必须与编译期注入时完全一致（同一个函数、同一条下钻规则），否则按索引兜底的 metaId 会错位。
 */
export function walkMarked(root: AstNode, visit: (hit: MarkedHit) => void): void {
  const step = (node: AstNode): void => {
    if (directivesNamed(node, META_DIRECTIVE).length > 0) {
      visit(readMarked(node))
      // 组件是叶节点；原生元素 / <template> 继续下钻，好让标记后代拿到自己的 id。
      if (isComponentTag(node)) return
    } else if (isComponentTag(node)) {
      // 未标记的组件整棵子树都不采集，避免把 el-form/el-row 的内部结构扫进元树。
      return
    }
    down(node, step)
  }
  down(root, step)
}

/** 下钻一层：先 children，再 v-if/v-else 各分支。 */
function down(node: AstNode, step: (child: AstNode) => void): void {
  for (const child of node.children ?? []) step(child)
  for (const branch of node.branches ?? []) for (const child of branch) step(child)
}

/** 把一个标记节点的指令读成配置。 */
function readMarked(node: AstNode): MarkedHit {
  const issues: string[] = []
  const hit: MarkedHit = {
    node,
    fields: {},
    permissionProps: directivesNamed(node, PERMISSION_META_DIRECTIVE),
    issues,
  }
  for (const directive of directivesNamed(node, META_DIRECTIVE)) {
    const arg = directive.arg?.content
    if (arg === 'id') {
      const value = readIdLiteral(directive.exp?.content)
      if (value === undefined || value === '') {
        issues.push(`v-meta:id 只接受静态 id 字面量（v-meta:id="user_query_area" 或 v-meta:id="'page:x'"）：${describe(node)}`)
      } else {
        hit.explicitId = value
      }
      continue
    }
    if (arg !== undefined) {
      issues.push(`v-meta 不支持参数 :${arg}（只支持 :id 或对象字面量）：${describe(node)}`)
      continue
    }
    const raw = directive.exp?.content
    if (raw === undefined) continue // <BizAddBtn v-meta /> 这类裸标记，只靠兜底 id。
    const fields = readObjectLiteral(raw)
    if (fields === undefined) {
      issues.push(`v-meta 只接受字面量字符串/对象，无法静态解析：${describe(node)} → ${raw}`)
      continue
    }
    for (const [key, value] of Object.entries(fields)) hit.fields[key] = value
  }

  if (isTemplateTag(node)) {
    if (hit.permissionProps.length > 0) {
      issues.push(`v-permission-meta 在 <template> 上无效（Vue 会静默丢弃该指令），请把指令移到真正渲染的元素上：${describe(node)}`)
    } else {
      issues.push(`<template> 只作文档分组用，自身不渲染 DOM，也不会出现在运行时代码里：${describe(node)}`)
    }
  }
  return hit
}

function describe(node: AstNode): string {
  const tag = node.tag ?? '?'
  const start = node.loc?.start
  return start === undefined ? `<${tag}>` : `<${tag}> @${start.line}:${start.column}`
}

/**
 * 读字面量：字符串、数字、布尔、null。非字面量一律返回 undefined。
 *
 * 刻意不 eval、也不引第三方解析器：v-meta 的表达式就是源码里的字面量，
 * 按字符扫一遍即可，既不执行任何用户代码，也不受表达式复杂度影响。
 */
export function readLiteral(source: string | undefined): string | undefined {
  if (source === undefined) return undefined
  const text = source.trim()
  if (text === '') return undefined
  const first = text[0]
  // 只收普通字符串字面量：模板串可能带 `${}` 插值，那是运行期表达式，不是静态元数据。
  if (first === "'" || first === '"') {
    const parsed = readQuoted(text)
    return parsed === undefined || parsed.rest.trim() !== '' ? undefined : parsed.value
  }
  if (text === 'true' || text === 'false' || text === 'null') return text
  if (/^-?\d+(\.\d+)?$/.test(text)) return text
  return undefined
}

/**
 * 读 v-meta:id 的值。
 *
 * 两种写法都收：纯标识符 `v-meta:id="user_query_area"`（spec 的写法，Vue 会把裸标识符
 * 当成表达式，但 id 语义就是常量，这里按字面量收）与带引号字符串
 * `v-meta:id="'user_query_area'"`（id 里含 `:`、空格等 JS 标识符不允许的字符时必须用这种）。
 * 其余形态（成员表达式、模板串插值等）一律拒绝并告警，避免「以为是固定 id，其实在跑表达式」。
 */
export function readIdLiteral(source: string | undefined): string | undefined {
  if (source === undefined) return undefined
  const text = source.trim()
  if (text === '') return undefined
  const first = text[0]
  if (first === "'" || first === '"') {
    const parsed = readQuoted(text)
    return parsed === undefined || parsed.rest.trim() !== '' ? undefined : parsed.value
  }
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(text) ? text : undefined
}

/** 读一个带引号的字符串，返回内容与剩余文本。 */
function readQuoted(text: string): { value: string; rest: string } | undefined {
  const quote = text[0]
  if (quote === undefined) return undefined
  let value = ''
  for (let i = 1; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\') {
      const next = text[i + 1]
      if (next === undefined) return undefined
      value += unescape(next, text, i)
      i += next === 'u' ? 5 : next === 'x' ? 3 : 1
      continue
    }
    if (char === quote) return { value, rest: text.slice(i + 1) }
    value += char
  }
  return undefined
}

function unescape(char: string, text: string, index: number): string {
  switch (char) {
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    case 'b': return '\b'
    case 'f': return '\f'
    case '0': return '\0'
    case 'u': {
      const hex = text.slice(index + 2, index + 6)
      return /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : 'u'
    }
    case 'x': {
      const hex = text.slice(index + 2, index + 4)
      return /^[0-9a-fA-F]{2}$/.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : 'x'
    }
    default: return char
  }
}

/** 把 `{ name: '…', desc: '…', group: '…' }` 读成键值对；出现非字面量则整体拒绝。 */
export function readObjectLiteral(source: string): Record<string, string> | undefined {
  const text = source.trim().replace(/;$/, '').trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined
  const out: Record<string, string> = {}
  for (const pair of splitTopLevel(text.slice(1, -1), ',')) {
    const entry = pair.trim()
    if (entry === '') continue
    const colon = topLevelIndex(entry, ':')
    if (colon < 0) return undefined
    const key = readKey(entry.slice(0, colon).trim())
    if (key === undefined || key === '') return undefined
    const value = readLiteral(entry.slice(colon + 1))
    if (value === undefined) return undefined
    out[key] = value
  }
  return out
}

/** 对象键：标识符或字符串字面量。 */
function readKey(text: string): string | undefined {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) return text
  const parsed = readQuoted(text)
  return parsed === undefined || parsed.rest.trim() !== '' ? undefined : parsed.value
}

/** 按「不在引号里、括号平衡」的位置切分。 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote !== '') {
      if (char === '\\') i += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '{' || char === '[' || char === '(') { depth += 1; continue }
    if (char === '}' || char === ']' || char === ')') { depth -= 1; continue }
    if (char === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

function topLevelIndex(text: string, separator: string): number {
  const parts = splitTopLevel(text, separator)
  return parts.length < 2 ? -1 : (parts[0] ?? '').length
}

/** 单个标记节点的注入计划：按节点身份绑定，重复注入天然幂等。 */
export interface MarkedNodePlan {
  metaId: string
  /** 该节点上的 v-permission-meta 指令（编译期会被写入静态 arg）。 */
  permissionProps: AstProp[]
}

/** 单次采集结果。 */
export interface MetaBuild {
  /** 本文件内的顶层根数组（文档序）。 */
  roots: MetaNode[]
  /** 节点身份 → 注入计划；编译期按此移除 v-meta 并回填静态 arg。 */
  nodes: Map<AstNode, MarkedNodePlan>
  /** `行:列` → 注入计划，编译期主键（AST 被重复编译时仍能命中）。 */
  byLoc: Map<string, MarkedNodePlan>
  /** 文档序的注入计划；AST 坐标不可用时按序兜底。 */
  ordered: MarkedNodePlan[]
  /** 采集告警（不阻断构建）。 */
  issues: string[]
  /**
   * 本模板把哪些本地 .vue 当**黑盒组件**用（相对路径，已排序）。
   *
   * 与 `roots` 是两件事：`roots` 是本文件自己的标记；这里是「本文件用到了谁的组件」。
   * 用途见 `mergeRoots`——被当组件用的文件，其内部标记不外泄为页面级区块。
   */
  componentFiles: string[]
}

export interface MetaBuildOptions {
  /** 该文件相对项目根的路径；写进节点 sourceFile，也是 page: id 的组成部分。 */
  sourceFile: string
  /** 组件标签 → 组件 .vue 文件相对路径；解析不到返回 null。 */
  resolveComponentFile: (tag: string) => string | null
}

/** 模板 AST → 元树。同一文件两次调用结果必须完全一致（确定性）。 */
export function buildMetaTree(root: AstNode, options: MetaBuildOptions): MetaBuild {
  const nodes = new Map<AstNode, MarkedNodePlan>()
  const byLoc = new Map<string, MarkedNodePlan>()
  const ordered: MarkedNodePlan[] = []
  const hits = new Map<AstNode, MarkedHit>()
  const issues: string[] = []
  let index = 0

  walkMarked(root, (hit) => {
    const plan: MarkedNodePlan = {
      metaId: resolveMetaId(hit, index, options),
      permissionProps: hit.permissionProps,
    }
    index += 1
    nodes.set(hit.node, plan)
    ordered.push(plan)
    const start = hit.node.loc?.start
    if (start !== undefined) {
      const key = locKey(start.line, start.column)
      if (!byLoc.has(key)) byLoc.set(key, plan)
    }
    hits.set(hit.node, hit)
    for (const issue of hit.issues) issues.push(issue)
  })

  const roots: MetaNode[] = []
  for (const node of nearestMarkedChildren(root)) {
    const built = toMetaNode(node, options.sourceFile, nodes, hits, issues)
    if (built !== undefined) roots.push(built)
  }
  // 黑盒组件清单：本模板里用到的本地 .vue（未标 v-meta 的组件标签也算）。
  const componentFiles = collectComponentFiles(root, options.resolveComponentFile)
  return { roots, nodes, byLoc, ordered, issues, componentFiles }
}

/**
 * 全模板递归：本文件把哪些本地 .vue 当组件用（**含未标 v-meta 的组件标签**）。
 *
 * 与 `walkMarked` 的分工不同：`walkMarked` 只认「标了 v-meta 的节点」（用来成树），
 * 这里要认「所有组件标签」（用来判定谁是黑盒），因此既不跳过未标记组件，也不提前剪枝。
 * 解析不到的标签（`el-*` 等全局组件、动态组件 `<component :is>`）不计入。
 *
 * 为什么需要它：被别的模板当组件用的文件，其内部 `v-meta` 属于「组件内部实现」，
 * 按 spec「黑盒、内部完全隔离」不得冒充页面级可配置区块（见 `mergeRoots`）。
 */
export function collectComponentFiles(
  root: AstNode,
  resolveComponentFile: (tag: string) => string | null,
): string[] {
  const out = new Set<string>()
  const step = (node: AstNode): void => {
    if (isComponentTag(node)) {
      const file = node.tag === undefined ? null : resolveComponentFile(node.tag)
      if (file !== null) out.add(file)
    }
    down(node, step)
  }
  down(root, step)
  return [...out].sort()
}

/** 一个 .vue 文件的采集产物（合并根时用的最小形状）。 */
export interface FileRoots {
  sourceFile: string
  roots: MetaNode[]
  componentFiles: readonly string[]
}

/** 合并结果：进 meta-tree.json 的根，以及被剔掉的文件。 */
export interface MergedRoots {
  roots: MetaNode[]
  /** 因「被当作黑盒组件使用」而整棵剔除的文件（内部标记不外泄）。 */
  skipped: string[]
}

/**
 * 合并多文件的根节点：按 `sourceFile` 排序平铺（契约形状），并剔除黑盒组件文件的根。
 *
 * 剔除规则的来历：插件会扫全部 `.vue`，包括 `BizAddBtn.vue` 这种业务组件自己的文件。
 * 组件内部的 `v-meta` 若照原样平铺进元树，就等于「打开了业务组件内部」——与
 * 「组件是黑盒、只当一个 `biz:` 节点、内部完全隔离」矛盾。所以：**只要某个文件被
 * 别的模板当作组件使用（哪怕那个组件标签没标 v-meta），它的根就不进元树**；
 * 该组件自身仍会作为一个 `biz:` 节点出现在**使用它**的页面上（那份 roots 属于页面）。
 *
 * 注意判据是「被 .vue 模板里的组件标签用到」，不是「被谁 import」。路由懒加载的页面
 * （`() => import('./pages/X.vue')` 写在 `.ts` 里）不会被当成组件，它的区块仍是页面级根。
 */
export function mergeRoots(files: readonly FileRoots[]): MergedRoots {
  const asComponent = new Set<string>()
  for (const file of files) for (const used of file.componentFiles) asComponent.add(used)
  const roots: MetaNode[] = []
  const skipped: string[] = []
  const sorted = [...files].sort((left, right) =>
    left.sourceFile < right.sourceFile ? -1 : left.sourceFile > right.sourceFile ? 1 : 0,
  )
  for (const file of sorted) {
    if (file.roots.length === 0) continue
    if (asComponent.has(file.sourceFile)) {
      skipped.push(file.sourceFile)
      continue
    }
    roots.push(...file.roots)
  }
  return { roots, skipped }
}

/** 兜底 id：显式 id > 组件按 biz: > 其余按 page:。 */
function resolveMetaId(hit: MarkedHit, index: number, options: MetaBuildOptions): string {
  if (hit.explicitId !== undefined && hit.explicitId !== '') return hit.explicitId
  const tag = hit.node.tag ?? ''
  if (isComponentTag(hit.node)) {
    const componentFile = options.resolveComponentFile(tag)
    // 只有「本页静态 import 的本地业务 SFC」才算独立业务组件，用组件文件路径做稳定 id。
    if (componentFile !== null) return bizMetaId(componentFile)
    // 其余组件（el-* 等基础组件显式标记、全局注册、动态组件）解析不到本地来源，
    // 它们本质是「本页就地划分」，按页面就地区块给 id，避免伪 biz: 前缀误导使用者。
  }
  return pageMetaId(options.sourceFile, index)
}

/** 元树下一层：最近的标记后代，穿透原生元素与 <template>，组件整棵跳过。 */
function nearestMarkedChildren(node: AstNode): AstNode[] {
  const out: AstNode[] = []
  const step = (child: AstNode): void => {
    if (directivesNamed(child, META_DIRECTIVE).length > 0) { out.push(child); return }
    if (isComponentTag(child)) return
    down(child, step)
  }
  down(node, step)
  return out
}

function toMetaNode(
  node: AstNode,
  sourceFile: string,
  nodes: Map<AstNode, MarkedNodePlan>,
  hits: Map<AstNode, MarkedHit>,
  issues: string[],
): MetaNode | undefined {
  const plan = nodes.get(node)
  if (plan === undefined) {
    issues.push(`内部错误：标记节点没有分配 metaId（${describe(node)}）`)
    return undefined
  }
  const fields = hits.get(node)?.fields ?? {}
  const children: MetaNode[] = []
  if (!isComponentTag(node)) {
    for (const child of nearestMarkedChildren(node)) {
      const built = toMetaNode(child, sourceFile, nodes, hits, issues)
      if (built !== undefined) children.push(built)
    }
  }
  return {
    metaId: plan.metaId,
    name: fields.name ?? '',
    desc: fields.desc ?? '',
    group: fields.group ?? '',
    sourceFile,
    tag: node.tag ?? '',
    children,
  }
}
