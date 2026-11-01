// 编译期核心：采集 template AST 里的 v-meta → 元树，并把 metaId 静态注入 v-permission-meta。
//
// 为什么放在编译期而不是运行期扫 DOM：
// - 运行期拿到的是渲染结果，v-for/v-if 之后只剩实例，还原不出「模板里定义了哪些区块」；
// - 元数据要在 build 前产出（后台拿它配置可见性），必须在 AST 阶段定稿；
// - 顺手把 v-meta 从产物里删干净，运行时零开销、零残留。
//
// 三条边界（与 README 一致）：
// 1. 只对「写了 v-meta / v-permission-meta 的标签」动手，不改业务组件渲染逻辑。
// 2. 业务组件一律黑盒：从不打开它的 .vue，也不展开它内部的结构。
// 3. 不写 DOM 属性：metaId 直接进指令参数（编译期常量），运行期不解析属性。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseSfc } from 'vue/compiler-sfc'
import type { CompilerOptions } from 'vue/compiler-sfc'
import type { Plugin, ResolvedConfig } from 'vite'
import {
  META_DIRECTIVE,
  PERMISSION_META_DIRECTIVE,
  buildMetaTree,
  locKey,
  mergeRoots,
  type AstNode,
  type AstProp,
  type FileRoots,
  type MarkedNodePlan,
  type MetaBuild,
  type MetaNode,
} from './meta.ts'

/** 交给 plugin-vue 的 `template.compilerOptions.nodeTransforms`。 */
export type TemplateNodeTransform = NonNullable<CompilerOptions['nodeTransforms']>[number]

/** 指令参数用的静态字符串表达式：编译期常量，运行期不进取值逻辑。 */
interface StaticExpression {
  type: 4
  content: string
  isStatic: true
  constType: 3
  loc: AstProp['loc']
}

export interface PermissionMetaOptions {
  /** 元数据输出路径，相对项目根；默认 `meta-tree.json`。 */
  output?: string
  /** 路径基准；默认取 Vite root。 */
  root?: string
  /** 采集要扫的顶层目录；默认 `src` 与 `packages`。 */
  directories?: string[]
  /** 额外排除的路径（node_modules 已默认排除）。 */
  exclude?: RegExp
  /**
   * 路径别名前缀 → 相对项目根的目录，用于把组件 import 解析成 `biz:` id。
   * 默认 `{ '@': 'src' }`；项目用了别的别名（`~`、`@app` 等）就在这里补。
   */
  pathAliases?: Record<string, string>
  /** 是否在控制台打印每个文件的采集汇总；默认 true。 */
  log?: boolean
}

/** 一个 .vue 文件的采集产物。 */
interface MetaEntry {
  build: MetaBuild
  sourceFile: string
}

/** 指令元数据：同一份 AST 可能被编译两遍（主模块与 `?vue&type=template`），按位置兜底。 */
function planFor(
  node: AstNode,
  build: MetaBuild,
  cursor: { index: number },
): MarkedNodePlan | undefined {
  const byIdentity = build.nodes.get(node)
  if (byIdentity !== undefined) return byIdentity
  const start = node.loc?.start
  if (start !== undefined) {
    const byPosition = build.byLoc.get(locKey(start.line, start.column))
    if (byPosition !== undefined) return byPosition
  }
  const ordinal = build.ordered[cursor.index]
  if (ordinal !== undefined) cursor.index += 1
  return ordinal
}

/** 把 metaId 写进 v-permission-meta 的参数；指令本身保持不动。 */
function injectArgument(props: AstProp[], metaId: string): void {
  for (const prop of props) {
    if (prop.type !== 7 || prop.name !== PERMISSION_META_DIRECTIVE) continue
    const arg: StaticExpression = { type: 4, content: metaId, isStatic: true, constType: 3, loc: prop.loc }
    prop.arg = arg
  }
}

/**
 * 采集 + 注入的编译器 transform，入口在 ROOT 节点做一次性遍历。
 *
 * ROOT 上的一次遍历能拿到未变换的纯净 AST（全部 v-meta 都在），下钻规则与
 * `buildMetaTree` 完全一致，所以「按索引兜底」的顺序不会错位。
 */
export function markPermissionMeta(
  produce: (root: AstNode, filename: string) => MetaEntry | null,
): TemplateNodeTransform {
  return ((node: AstNode, context: { filename: string }) => {
    if (node.type !== 0) return
    const entry = produce(node, context.filename)
    if (entry === null) return
    const cursor = { index: 0 }
    const step = (current: AstNode): void => {
      const plan = planFor(current, entry.build, cursor)
      if (plan !== undefined) {
        const props = current.props ?? []
        if (props.some((prop) => prop.type === 7 && prop.name === PERMISSION_META_DIRECTIVE)) {
          injectArgument(props, plan.metaId)
        }
        // 移除 v-meta（含 v-meta:id 与裸标记），产物里不留指令。
        current.props = props.filter((prop) => !(prop.type === 7 && prop.name === META_DIRECTIVE))
      }
      for (const child of current.children ?? []) step(child)
      for (const branch of current.branches ?? []) for (const child of branch) step(child)
    }
    step(node)
  }) as unknown as TemplateNodeTransform
}

/**
 * 宿主侧插件：采集元树 → 写 meta-tree.json → 给 plugin-vue 装编译器 transform。
 *
 * 零配置用法（`permissionMeta()` 必须排在 `vue()` 之前）：
 * ```ts
 * plugins: [permissionMeta(), vue()]
 * ```
 */
export function permissionMeta(options: PermissionMetaOptions = {}): Plugin {
  const output = options.output ?? 'meta-tree.json'
  const directories = options.directories ?? ['src', 'packages']
  const aliases = options.pathAliases ?? { '@': 'src' }
  const verbose = options.log ?? true

  let resolvedRoot = options.root ?? process.cwd()

  const entries = new Map<string, MetaEntry>()
  const roots = new Map<string, MetaNode[]>()
  const reported = new Set<string>()
  const imports = new Map<string, Map<string, string>>()
  /** 等重扫的文件（绝对路径）。重扫放在 flush，确保读到的是写完后的内容，不会采到半个文件。 */
  const dirty = new Set<string>()
  /** 内容已变、缓存不再可信的文件（相对路径）。只标记，不删数据：读不到新内容时保留上一次结果。 */
  const stale = new Set<string>()
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let flushing = false

  const keyOf = (filename: string): string => normalize(path.relative(resolvedRoot, filename))

  /** 该 .vue 的静态 import 表：本地组件名 → 组件文件相对路径。 */
  const importsOf = (filename: string): Map<string, string> => {
    const cached = imports.get(filename)
    if (cached !== undefined) return cached
    const table = new Map<string, string>()
    imports.set(filename, table)
    let source: string
    try {
      source = readFileSync(filename, 'utf8')
    } catch {
      return table
    }
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1]
    if (script === undefined) return table
    // 只认静态 import：v-meta 的 id 要靠编译期判定；动态 import()/require 的组件退兜底 id。
    // 覆盖三种常见写法：
    //   import BizAddBtn from './BizAddBtn.vue'
    //   import BizAddBtn, { helper } from './BizAddBtn.vue'
    //   import { default as BizAddBtn } from './BizAddBtn.vue'
    const from = /import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g
    for (const match of script.matchAll(from)) {
      const clause = match[1]
      const specifier = match[3]
      if (clause === undefined || specifier === undefined) continue
      const target = resolveSpecifier(filename, specifier)
      if (target === null) continue
      // 从句里挑出「默认导入」绑定名：`A`、`A, {…}`、`{ default as A, … }`。
      for (const local of defaultBindings(clause)) table.set(local, target)
    }
    return table
  }

  /**
   * import 说明符 → 相对项目根的 .vue 路径；解析不到返回 null。
   *
   * 基准要分清：相对路径（`./`、`../`）相对**导入方文件**；别名（`@/x`）与仓库根绝对路径
   * （`/src/x`）相对**项目根**——搞混就会解析出 `src/src/...` 这种不存在的路径。
   */
  const resolveSpecifier = (filename: string, specifier: string): string | null => {
    // 只认本地 .vue：包名（`element-plus`、`@scope/pkg`）不是业务组件，直接放弃。
    if (!specifier.endsWith('.vue')) return null
    if (specifier.startsWith('.')) {
      return normalize(path.relative(resolvedRoot, path.resolve(path.dirname(filename), specifier)))
    }
    if (specifier.startsWith('/')) {
      return normalize(specifier.slice(1))
    }
    const prefix = Object.keys(aliases)
      .filter((alias) => specifier.startsWith(`${alias}/`))
      .sort((left, right) => right.length - left.length)[0]
    if (prefix === undefined) return null
    return normalize(`${aliases[prefix]}/${specifier.slice(prefix.length + 1)}`)
  }

  /** 采集一个文件；同一 sourceFile 只建一次树，重复编译直接命中缓存。 */
  const produce = (ast: AstNode, filename: string): MetaEntry | null => {
    if (!filename.endsWith('.vue')) return null
    if (filename.split(path.sep).includes('node_modules')) return null
    if (options.exclude?.test(filename)) return null
    const sourceFile = keyOf(filename)
    const cached = entries.get(sourceFile)
    if (cached !== undefined && !stale.has(sourceFile)) return cached
    // 缓存的 AST 已过期：用当前这份 AST 重算，模板注入立刻準确，不必等磁盘重扫。
    stale.delete(sourceFile)

    const build = buildMetaTree(ast, {
      sourceFile,
      resolveComponentFile: (tag) => importsOf(filename).get(tag) ?? null,
    })
    return remember({ build, sourceFile })
  }

  const remember = (entry: MetaEntry): MetaEntry => {
    entries.set(entry.sourceFile, entry)
    roots.set(entry.sourceFile, entry.build.roots)
    for (const issue of entry.build.issues) {
      const line = `${entry.sourceFile}: ${issue}`
      if (reported.has(line)) continue
      reported.add(line)
      // 采集告警不阻断构建：多数是「写法不规范 / 写了但运行时无效」，必须让人看见。
      console.warn(`[permission-meta] ${line}`)
    }
    if (verbose && entry.build.roots.length > 0) {
      console.log(`[permission-meta] ${entry.sourceFile} → ${countNodes(entry.build.roots)} 个元节点`)
    }
    if (!flushing) schedule()
    return entry
  }

  /**
   * 把所有文件的本文件根平铺成契约形状的顶层数组，并剔除「被当组件用」的文件的根。
   *
   * 剔除判据与原因见 `mergeRoots`（meta.ts）：组件内部标记不是页面级区块，不外泄。
   */
  const mergedRoots = (): MetaNode[] => {
    const files: FileRoots[] = []
    for (const [sourceFile, nodes] of roots) {
      files.push({
        sourceFile,
        roots: nodes,
        componentFiles: entries.get(sourceFile)?.build.componentFiles ?? [],
      })
    }
    const merged = mergeRoots(files)
    if (verbose && merged.skipped.length > 0) {
      // 只报一次，避免 HMR 反复刷同一行。
      const line = `[permission-meta] 黑盒组件内部标记不计入元树：${merged.skipped.join(', ')}`
      if (!reported.has(line)) {
        reported.add(line)
        console.log(line)
      }
    }
    return merged.roots
  }

  /**
   * 落盘去抖：一次构建里几十个文件各自触发，合并成一次「重扫 + 写」。
   *
   * 重扫放在这里（而不是 handleHotUpdate 里同步读文件），是因为编辑器写文件有个过程，
   * 事件到时内容可能还没落定；等一小段再读，采到的一定是最终模板，也不会闪成空树。
   */
  const schedule = (): void => {
    if (scheduled !== undefined) return
    scheduled = setTimeout(() => {
      scheduled = undefined
      flush()
    }, 40)
    scheduled.unref?.()
  }

  /** 重扫所有脏文件 + 落盘；带重入保护，避免重扫过程再排一次队。 */
  const flush = (): void => {
    if (flushing) return
    flushing = true
    try {
      for (const file of dirty) scanFile(file)
      dirty.clear()
      write()
    } finally {
      flushing = false
    }
  }

  const write = (): void => {
    const payload = serialize()
    const target = path.resolve(resolvedRoot, output)
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, payload, 'utf8')
    } catch (error) {
      console.error(`[permission-meta] 写入 ${output} 失败：`, error)
    }
  }

  /** 落盘内容：顶层就是根数组（契约形状），层级关系只在每个节点的 children 里。 */
  const serialize = (): string => `${JSON.stringify(mergedRoots(), null, 2)}\n`

  /**
   * 直接从磁盘采集一个文件：跳过 vite 模块图，纯解析模板。
   *
   * 两种场景都用它：初始化时补齐「不在当前模块图里」的文件（后台不必等页面被访问），
   * 以及 HMR 后立刻刷新该文件的元数据——不依赖浏览器再请求一次。
   */
  const scanFile = (absolute: string): void => {
    const sourceFile = keyOf(absolute)
    if (options.exclude?.test(absolute)) return
    let source: string
    try {
      source = readFileSync(absolute, 'utf8')
    } catch (error) {
      // 只有「确实不存在」才撤掉元数据；其余读取失败当成暂时不可读，保留上一次结果。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entries.delete(sourceFile)
        roots.delete(sourceFile)
      }
      return
    }
    // 编辑器常先截断再写入，此时会读到空文件；这不是「标记被删了」，
    // 保留上一次结果，等真正的写入事件再更新，否则元数据会被闪成空。
    if (source.trim() === '') return
    if (!source.includes(`v-${META_DIRECTIVE}`) && !source.includes(`v-${PERMISSION_META_DIRECTIVE}`)) {
      entries.delete(sourceFile)
      roots.delete(sourceFile)
      return
    }
    let ast: AstNode | undefined
    try {
      ast = parseSfc(source, { filename: absolute }).descriptor.template?.ast as AstNode | undefined
    } catch {
      return
    }
    if (ast === undefined) return
    remember({
      build: buildMetaTree(ast, {
        sourceFile,
        resolveComponentFile: (tag) => importsOf(absolute).get(tag) ?? null,
      }),
      sourceFile,
    })
  }

  /** 扫全部源码目录，补齐不在模块图里的文件。 */
  const scanDisk = (): void => {
    for (const file of collectVueFiles(resolvedRoot, directories)) scanFile(path.resolve(resolvedRoot, file))
  }

  return {
    name: 'addzero:permission-meta',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      resolvedRoot = options.root ?? config.root
      const vue = config.plugins.find((plugin) => plugin.name === 'vite:vue') as
        | { api?: { options?: { template?: { compilerOptions?: CompilerOptions } } } }
        | undefined
      const vueOptions = vue?.api?.options
      if (vueOptions === undefined) {
        // 常见原因：项目没装 @vitejs/plugin-vue，或 permissionMeta() 排在了 vue() 之后。
        console.warn(
          '[permission-meta] 未拿到 @vitejs/plugin-vue 的 options；请把 permissionMeta() 放在 vue() 之前',
        )
        return
      }
      // `template` 可能本来就没写：这里就地补一个，plugin-vue 的 configResolved 会把它带过去。
      const template = (vueOptions.template ??= {})
      const compilerOptions = (template.compilerOptions ??= {})
      compilerOptions.nodeTransforms = [
        ...(compilerOptions.nodeTransforms ?? []),
        markPermissionMeta(produce),
      ]
    },

    buildStart() {
      scanDisk()
      write()
    },

    configureServer() {
      // dev 启动即产出一次：后台不必等页面被访问才知道有哪些可配置区块。
      scanDisk()
      write()
    },

    handleHotUpdate(context) {
      // 只有 .vue 会产元数据；改动过的文件丢缓存并标脏，等 flush 时统一重扫。
      if (!context.file.endsWith('.vue')) return
      const key = keyOf(context.file)
      // 只标脏：缓存标记为过期、import 表作废；数据本身留着，
      // 万一磁盘内容还没写定也能保住上一次结果，不会被清成空树。
      stale.add(key)
      imports.delete(key)
      dirty.add(context.file)
      schedule()
    },

    buildEnd() {
      write()
    },
  }
}

/** 统计元节点总数（含子节点），仅用于日志。 */
function countNodes(nodes: readonly MetaNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}

/** 扫描时默认跳过的目录：产物、依赖、以及仓库里的示例工程（示例自带 v-meta，不该混进项目元数据）。 */
export const SKIP_DIRECTORIES: readonly string[] = [
  'node_modules', 'dist', '.git', '.run', '.data', 'coverage', 'examples', 'demo', '__tests__', 'tests',
]

/** 目录扫描：只认源码目录，不碰 node_modules 与产物目录。 */
export function collectVueFiles(root: string, directories: readonly string[]): string[] {
  const skip = new Set(SKIP_DIRECTORIES)
  const files: string[] = []
  const visit = (dir: string): void => {
    let dirents
    try {
      dirents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of dirents) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) visit(full)
        continue
      }
      if (entry.name.endsWith('.vue')) files.push(normalize(path.relative(root, full)))
    }
  }
  for (const dir of directories) visit(path.join(root, dir))
  return files.sort()
}

/** 从 import 从句里取出「默认导入」的本地名，忽略具名/命名空间导入。 */
function defaultBindings(clause: string): string[] {
  const names: string[] = []
  // 开头直接是标识符 → 默认导入（后面可能跟 `, {…}`）。
  const head = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause)
  if (head?.[1] !== undefined) names.push(head[1])
  // 解构里的 `default as X`。
  const brace = /{([\s\S]*)}/.exec(clause)?.[1]
  if (brace !== undefined) {
    for (const item of brace.split(',')) {
      const named = /^\s*default\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(item)
      if (named?.[1] !== undefined) names.push(named[1])
    }
  }
  return names
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/')
}
