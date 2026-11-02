// 页面助手的运行时服务：全站唯一的 PageAgent 实例宿主。
//
// 为什么不把 PageAgent 塞进组件：面板是长生命周期的浮动 UI，路由切换不该重建 agent
// （否则每次跳页都丢历史、丢中断状态）。因此实例归服务，页面/触发器只调用它的
// 公开方法。
//
// 两级加载，对应两套可见性：
// - 入口视图（免登录）：只回答「显不显示、长什么样」，用于外壳一进来就有入口；
// - 完整设置（需登录）：供应商、模型、提示词、脱敏规则，只在真正要跑任务时才拉，
//   并且配置改动后 `reload()` 能让下一次任务立即用上新参数。
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import { ElMessageBox } from 'element-plus'
// 只引类型：库本身按需加载（约 500 kB），首屏不该为「可能用不到」的助手付费。
import type { PageAgent, PageAgentTool } from 'page-agent'
import type { CanvasDrawTool } from '@/plugins/ai/canvas-tool'
// 与 page-agent 共享同一份 zod（库内部用的就是 `zod/v4`）；各引一份会出现两套 schema 类型。
import * as z from 'zod/v4'
import type { HttpRegistry } from '@/kernel'
import {
  fetchEntryView,
  fetchPageAgentSettings,
  type EntryStyle,
  type MaskRule,
  type PageAgentSettingsView,
  type RouteInstruction,
} from './api'

/** 与 PageAgent 的状态机对齐，避免宿主自己再发明一套名字。 */
export type AgentState = 'idle' | 'running' | 'completed' | 'error' | 'stopped' | 'disposed'

export interface AgentHistoryItem {
  type: 'step' | 'observation' | 'user_takeover' | 'retry' | 'error'
  stepIndex?: number
  reflection?: { evaluation_previous_goal?: string; memory?: string; next_goal?: string }
  action?: { name: string; input: unknown; output: string }
  content?: string
  attempt?: number
  maxAttempts?: number
  message?: string
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'
}

function token(): string | null {
  return localStorage.getItem('micro-admin.token')
}

/** 路径匹配：`re:` 前缀按正则，其它按前缀。 */
export function matchRoute(rules: RouteInstruction[], path: string): string {
  for (const rule of rules) {
    if (rule.pattern.startsWith('re:')) {
      try {
        if (new RegExp(rule.pattern.slice(3)).test(path)) return rule.instruction
      } catch {
        /* 非法正则当作不匹配，不让一条坏配置拖垮整个助手 */
      }
      continue
    }
    if (path === rule.pattern || path.startsWith(rule.pattern)) return rule.instruction
  }
  return ''
}

/** 脱敏：命中即替换。坏正则跳过，避免一条规则让整页内容发不出去。 */
export function maskContent(content: string, rules: MaskRule[]): string {
  let output = content
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue
    try {
      output = output.replace(new RegExp(rule.pattern, 'g'), rule.replacement || '***')
    } catch {
      /* 忽略非法规则 */
    }
  }
  return output
}

/** 允许运行助手的路径判定：空数组 = 全站。 */
export function pathAllowed(allowPaths: readonly string[], path: string): boolean {
  if (allowPaths.length === 0) return true
  return allowPaths.some((prefix) => path === prefix || path.startsWith(prefix))
}

/**
 * 配置未到达时的兜底外观。
 *
 * 这**不是**第二份默认值来源：真正的默认值只存在于后端 `settings.ts`，
 * 这里只是「视图还没拉回来」这一瞬间的占位，拉回后立即被覆盖。
 */
const ENTRY_PLACEHOLDER: EntryStyle = {
  label: '页面助手',
  showLabel: false,
  accent: 'var(--brand)',
}

export interface PageAgentRuntime {
  /** 入口视图（免登录）；外壳据此决定入口是否出现。 */
  readonly entryView: Ref<{ enabled: boolean; ready: boolean; allowPaths: string[] } | null>
  /** 插件总开关：入口按钮是否该出现在顶栏。 */
  readonly available: ComputedRef<boolean>
  /** 完整设置（需登录）；打开面板/跑任务时才需要。 */
  readonly settings: Ref<PageAgentSettingsView | null>
  readonly loading: Ref<boolean>
  readonly error: Ref<string | null>
  readonly state: Ref<AgentState>
  readonly task: Ref<string>
  readonly history: Ref<AgentHistoryItem[]>
  readonly lastAnswer: Ref<{ success: boolean; text: string } | null>
  readonly panelOpen: Ref<boolean>
  readonly entry: Ref<EntryStyle>
  readonly zIndex: Ref<number>
  readonly panelPolicy: Ref<'auto' | 'always' | 'none'>
  readonly canRun: ComputedRef<boolean>
  /** 拉入口视图；外壳启动时调用。 */
  loadEntry(): Promise<void>
  /** 拉完整设置并重建实例；设置页保存后调用。 */
  reload(): Promise<void>
  open(): Promise<void>
  close(): void
  toggle(): Promise<void>
  run(task: string): Promise<void>
  stop(): Promise<void>
  syncPath(path: string): void
}

export function createPageAgentRuntime(options: {
  http: HttpRegistry
  /**
   * 画布工具：由 `ai` 插件注册的服务。用惰性函数拿（而不是直接传实例），
   * 因为插件启动顺序由内核决定——这里只声明「需要时去取」，不假设谁先谁后。
   */
  canvasTool?: (() => CanvasDrawTool | null) | undefined
}): PageAgentRuntime {
  const http = options.http
  const entryView = shallowRef<{ enabled: boolean; ready: boolean; allowPaths: string[] } | null>(null)
  const settings = shallowRef<PageAgentSettingsView | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const state = ref<AgentState>('idle')
  const task = ref('')
  const history = ref<AgentHistoryItem[]>([])
  const lastAnswer = ref<{ success: boolean; text: string } | null>(null)
  const panelOpen = ref(false)
  const entry = ref<EntryStyle>({ ...ENTRY_PLACEHOLDER })
  const zIndex = ref(2_147_483_000)
  const panelPolicy = ref<'auto' | 'always' | 'none'>('auto')
  const currentPath = ref(typeof location === 'undefined' ? '/' : location.pathname)

  let agent: PageAgent | null = null
  // 面板是库自带 DOM，不参与 Vue 响应式；单独持有句柄用于同步显隐与配色。
  let panelEl: HTMLElement | null = null

  const canRun = computed(() => {
    const view = entryView.value
    if (!view || !view.enabled || !view.ready) return false
    return pathAllowed(view.allowPaths, currentPath.value)
  })

  /** 入口是否出现只看总开关：未配置完整时也保留入口，点一下给出明确原因。 */
  const available = computed(() => entryView.value?.enabled === true)

  function bindAgentEvents(instance: PageAgent): void {
    const sync = (): void => {
      state.value = instance.status as AgentState
      history.value = [...(instance.history as AgentHistoryItem[])]
      const result = instance.lastResult
      if (result) lastAnswer.value = { success: result.success, text: String(result.data ?? '') }
      panelOpen.value = instance.panel.wrapper.style.display !== 'none'
    }
    instance.addEventListener('statuschange', sync)
    instance.addEventListener('historychange', sync)
    instance.addEventListener('activity', sync)
    instance.addEventListener('dispose', () => {
      state.value = 'disposed'
    })
    sync()
  }

  /**
   * 构造代理 fetch：密钥不在浏览器，请求统一带上登录令牌与本页路径。
   *
   * 路径用 query 传（而不是自定义头）是为了让代理端按 `allowPaths` 精准拒绝，
   * 且不依赖 CORS 预检里的自定义头白名单。
   *
   * 还要把宿主统一的 `{code,message,data}` 外壳拆掉：库按裸 OpenAI 响应解析
   * （`data.choices[0]`），把外壳原样交给它只会得到「No choices in response」。
   * 这里只解一层壳、不改造内容，代理的返回形状仍与 OpenAI 兼容。
   */
  async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, location.origin)
    url.searchParams.set('page', currentPath.value)
    const headers = new Headers(init?.headers)
    const bearer = token()
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`)

    const response = await fetch(url.toString(), { ...init, headers })
    const payload = (await response.json().catch(() => null)) as
      | { code?: number; message?: string; data?: unknown }
      | null

    // 兼容两种上游形态：宿主的信封（code/data），或已是裸 OpenAI 响应。
    if (payload && typeof payload === 'object' && 'code' in payload) {
      const ok = response.ok && payload.code === 0
      const body = ok
        ? JSON.stringify(payload.data ?? {})
        : JSON.stringify({ error: { message: payload.message ?? `请求失败（HTTP ${response.status}）` } })
      return new Response(body, {
        status: ok ? 200 : (response.status >= 400 ? response.status : 502),
        statusText: ok ? 'OK' : 'Proxy Error',
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(payload ?? {}), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  function disposeAgent(): void {
    if (!agent) return
    try {
      agent.dispose()
    } catch {
      /* 库在 dispose 里会移除面板；已经移除过就不重复报错 */
    }
    agent = null
    panelEl = null
    history.value = []
    state.value = 'idle'
    panelOpen.value = false
  }

  /** 面板配色/尺寸全部来自设置：库的 CSS 变量名保持不变，宿主只改值。 */
  function stylePanel(): void {
    const panel = settings.value?.panel
    if (!panelEl || !panel) return
    const root = panelEl.style
    root.setProperty('--width', `${panel.width}px`)
    root.setProperty('--height', `${panel.height}px`)
    root.setProperty('--border-radius', `${panel.radius}px`)
    root.setProperty('--side-space', `${panel.sideSpace}px`)
    root.setProperty('--color-1', panel.colorFrom)
    root.setProperty('--color-2', panel.colorTo)
    root.setProperty('--color-3', panel.accent)
    root.setProperty('--color-4', panel.accent)
    root.bottom = `${panel.offsetBottom}px`
    root.zIndex = String(panel.zIndex)
    root.setProperty('text-align', 'left')
  }

  function canvasDrawTool(): CanvasDrawTool | null {
    try {
      return options.canvasTool?.() ?? null
    } catch {
      return null
    }
  }

  /**
   * 把画布工具包成 PageAgent 的 `customTools`。
   *
   * 用页面的 zod 实例构造 schema（与库共享同一份 zod，避免出现两份 zod 导致类型/校验错位）；
   * 描述里写清「什么情况该用」——模型只会看见描述，看不见我们的注释。
   */
  function canvasTools(): Record<string, PageAgentTool> {
    return {
      draw_on_scada_canvas: {
        description:
          '在当前打开的组态画布上按自然语言画图或排版（新增图元、对齐、改间距、补仪表等）。' +
          '指令会经过服务端指令集校验后直接写到画布；写完之后不要自动保存，交给用户点「保存」。' +
          '如果用户的要求缺关键参数（量程、单位、点位号），先用 ask_user 问清楚再画。',
        inputSchema: z.object({
          instruction: z.string().describe('要画什么/改哪里，一句话即可，例如「把三台泵排成一行，间距一致」'),
          promptId: z.enum(['scada.draw', 'scada.layout']).optional().describe('scada.draw 画新内容；scada.layout 只做排版修正'),
        }),
        execute: async (input: { instruction: string; promptId?: 'scada.draw' | 'scada.layout' }) => {
          // 每次调用现取工具：助手实例是长生命的，而「打开的画布」随时在变，
          // 把工具在构造时固定下来会出现「先在别的页开了助手，回画布页却不会画」。
          const tool = canvasDrawTool()
          if (!tool) return '当前没有可用的画布工具（`ai` 插件未启用）。'
          const outcome = await tool.run(input.instruction, { promptId: input.promptId ?? 'scada.draw' })
          const lines = [outcome.text]
          if (outcome.applied.length) lines.push(`已应用指令：${outcome.applied.map((line) => `\n- ${line}`).join('')}`)
          const problems = outcome.issues.filter((item) => item.severity === 'error')
          if (problems.length) {
            lines.push(`未通过校验：${problems.map((item) => `\n- 第 ${item.line} 行：${item.message}`).join('')}`)
          }
          return lines.join('\n')
        },
      },
    }
  }

  /**
   * 首次真正要用时才把库拉下来。
   *
   * 静态 import 会把 ~500 kB 打进入口 vendor 包，每个页面都要付这笔带宽；
   * 而助手只在用户点顶栏入口/跑任务时才需要，按需加载后首屏完全不受影响。
   */
  let PageAgentClass: typeof import('page-agent').PageAgent | null = null

  async function loadAgentClass(): Promise<typeof import('page-agent').PageAgent> {
    if (!PageAgentClass) {
      const module = await import('page-agent')
      PageAgentClass = module.PageAgent
    }
    return PageAgentClass
  }

  async function ensureAgent(): Promise<PageAgent | null> {
    const config = settings.value
    if (!config || !config.ready) return null
    if (agent) return agent

    const Ctor = await loadAgentClass()
    agent = new Ctor({
      // 供应商地址由后端持有；浏览器只知道同源代理，因此这里拼的是本站 API 前缀。
      baseURL: `${apiBase()}${config.proxyPath}`,
      model: config.model,
      // 占位而非真实密钥：真正的鉴权在代理端，浏览器侧永远拿不到 key。
      apiKey: 'proxy',
      language: config.language,
      maxSteps: config.maxSteps,
      stepDelay: config.stepDelay,
      maxRetries: config.maxRetries,
      disableNamedToolChoice: config.disableNamedToolChoice,
      enableMask: config.enableMask,
      promptForNextTask: config.promptForNextTask,
      customFetch: proxyFetch,
      // 画布工具：在组态画布页把「按自然语言改画布」交给当前这个对话框，
      // 不另开助手、不复用第二个密钥。没有打开画布时工具会给出人话提示而不是瞎点 DOM。
      ...(options.canvasTool ? { customTools: canvasTools() } : {}),
      experimentalScriptExecutionTool: config.experimentalScriptExecution,
      experimentalLlmsTxt: config.experimentalLlmsTxt,
      ...(config.customSystemPrompt ? { customSystemPrompt: config.customSystemPrompt } : {}),
      ...(config.systemInstructions || config.routeInstructions.length > 0
        ? {
            instructions: {
              ...(config.systemInstructions ? { system: config.systemInstructions } : {}),
              getPageInstructions: (url: string) => {
                const path = (() => {
                  try {
                    return new URL(url, location.origin).pathname
                  } catch {
                    return url
                  }
                })()
                return matchRoute(config.routeInstructions, path) || undefined
              },
            },
          }
        : {}),
      ...(config.maskRules.length > 0
        ? { transformPageContent: (content: string) => maskContent(content, config.maskRules) }
        : {}),
    })

    // 缺参追问走对话框而不是 `window.prompt`：模型问一句、人答一句，答完继续跑同一个任务。
    // `onAskUser` 是实例属性（库在构造后按它决定是否保留 ask_user 工具），不是 config 字段。
    agent.onAskUser = (question: string) =>
      ElMessageBox.prompt(question, '页面助手提问', {
        confirmButtonText: '回答',
        cancelButtonText: '跳过',
        inputPlaceholder: '直接回答即可，留空表示跳过',
        distinguishCancelAndClose: true,
      })
        .then((result) => result.value ?? '')
        .catch(() => '（用户没有回答，请自行决定或先完成其它步骤）')

    bindAgentEvents(agent)
    panelEl = agent.panel.wrapper
    stylePanel()
    if (panelPolicy.value === 'none') agent.panel.hide()
    return agent
  }

  /** 每次交互都以「当前真实路径」为准：白名单与页面指令都按它判定。 */
  function refreshPath(): void {
    if (typeof location !== 'undefined') currentPath.value = location.pathname
  }

  async function loadSettings(): Promise<PageAgentSettingsView | null> {
    if (settings.value) return settings.value
    try {
      const next = await fetchPageAgentSettings(http)
      settings.value = next
      return next
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '读取页面助手设置失败'
      return null
    }
  }

  async function open(): Promise<void> {
    refreshPath()
    if (!canRun.value) {
      const view = entryView.value
      error.value = view?.enabled === false
        ? '页面助手已停用：在「页面助手」设置里打开总开关'
        : view?.ready === false
          ? '页面助手未配置完整：设置 baseUrl、模型与密钥'
          : '当前页面不在允许运行助手的路径白名单内'
      return
    }
    const config = await loadSettings()
    if (!config) return
    const instance = await ensureAgent()
    if (!instance) return
    error.value = null
    instance.panel.show()
    panelOpen.value = true
  }

  function close(): void {
    agent?.panel.hide()
    panelOpen.value = false
  }

  async function toggle(): Promise<void> {
    if (panelOpen.value) close()
    else await open()
  }

  async function run(next: string): Promise<void> {
    const text = next.trim()
    if (!text) return
    refreshPath()
    if (!canRun.value) {
      await open()
      return
    }
    const config = await loadSettings()
    if (!config) return
    const instance = await ensureAgent()
    if (!instance) return
    error.value = null
    task.value = text
    lastAnswer.value = null
    instance.panel.show()
    panelOpen.value = true
    try {
      await instance.execute(text)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      state.value = 'error'
    }
  }

  async function stop(): Promise<void> {
    await agent?.stop()
  }

  async function loadEntry(): Promise<void> {
    try {
      const view = await fetchEntryView(http)
      entryView.value = { enabled: view.enabled, ready: view.ready, allowPaths: view.allowPaths }
      entry.value = { ...view.entry }
      zIndex.value = view.panel.zIndex
      panelPolicy.value = view.panelPolicy
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '读取页面助手入口视图失败'
    }
  }

  /** 配置变了就重建：模型、步数、脱敏规则都必须在下一次任务前生效。 */
  async function reload(): Promise<void> {
    loading.value = true
    try {
      const [view, config] = await Promise.all([fetchEntryView(http), fetchPageAgentSettings(http)])
      entryView.value = { enabled: view.enabled, ready: view.ready, allowPaths: view.allowPaths }
      entry.value = { ...view.entry }
      zIndex.value = view.panel.zIndex
      panelPolicy.value = view.panelPolicy
      settings.value = config
      disposeAgent()
      error.value = null
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '读取页面助手设置失败'
    } finally {
      loading.value = false
    }
  }

  /**
   * 路由变化时调用：只更新路径，不销毁实例。
   *
   * 面板里留着上一条任务的结论，用户可能还在读；正在跑的任务也不该被换页打断。
   */
  function syncPath(path: string): void {
    currentPath.value = path
  }

  return {
    entryView,
    available,
    settings,
    loading,
    error,
    state,
    task,
    history,
    lastAnswer,
    panelOpen,
    entry,
    zIndex,
    panelPolicy,
    canRun,
    loadEntry,
    reload,
    open,
    close,
    toggle,
    run,
    stop,
    syncPath,
  }
}
