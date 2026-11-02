// 页面助手（PageAgent）的设置：全部落在存储里，界面可改，密钥永不下发浏览器。
//
// 三条边界：
// 1. 浏览器只拿到「公开视图」——model / baseUrl / 行为参数 / 面板外观，
//    `apiKey` 只有 `hasApiKey` 与末四位提示，模型调用统一走后端代理；
// 2. 首次启动的默认值只来自环境变量（`PAGE_AGENT_*`，见 deploy/.env），
//    代码里不写任何主机、端口与密钥，也不存在第二份默认值；
// 3. 非法字段回落到默认值而不是整份拒绝：面板宽度写错不该让助手整体不可用。
import type { KeyValueStore } from '@zjarlin/ui-server'

export const PAGE_AGENT_CONFIG_PERMISSION = 'system:page-agent:config'
const SETTINGS_KEY = 'page-agent:settings'

export type PageAgentLanguage = 'zh-CN' | 'en-US'

/** 面板出现时机：auto = 运行时自动展开；always = 常驻；none = 不显示（静默执行）。 */
export type PanelPolicy = 'auto' | 'always' | 'none'

/**
 * 顶栏入口外观：全站唯一的助手入口（外壳图纸上的 AI 图标，点击执行 `page-agent.toggle`）。
 *
 * 入口固定在外壳顶栏，不再提供「角落浮标」这类第二位置——同一动作只留一个入口。
 */
export interface EntryStyle {
  /** 提示与无障碍文案；顶栏空间不足时只显示图标，文案进 tooltip。 */
  label: string
  /** 是否在图标旁显示文案；窄屏由容器查询自动收起。 */
  showLabel: boolean
  /** 悬停/激活态的强调色：`var(--brand)` 或任意 CSS 颜色。 */
  accent: string
}

export interface PanelStyle {
  /** 面板宽度（px）。库默认 360。 */
  width: number
  /** 收起时高度（px）。库默认 40。 */
  height: number
  /** 距视口底部（px）。库默认 100。 */
  offsetBottom: number
  /** 控制条两侧留白（px）。库默认 12。 */
  sideSpace: number
  /** 圆角（px）。库默认 12。 */
  radius: number
  /** 运行态渐变起点色。 */
  colorFrom: string
  /** 运行态渐变终点色。 */
  colorTo: string
  /** 静止态强调色。 */
  accent: string
  zIndex: number
}

/** 按路径匹配的附加指令：同一句话在不同页面给模型不同的上下文。 */
export interface RouteInstruction {
  /** 路径前缀或正则（`re:` 开头）。 */
  pattern: string
  instruction: string
}

/** 发送给模型前的脱敏规则：命中即替换，避免把手机号/证件号送给模型。 */
export interface MaskRule {
  label: string
  pattern: string
  replacement: string
  enabled: boolean
}

export interface PageAgentSettings {
  /** 总开关：关闭后顶栏入口不出现，代理也拒绝调用。 */
  enabled: boolean
  /** OpenAI 兼容网关地址（含 /v1）。 */
  baseUrl: string
  model: string
  /** 仅存服务端；公开视图只给掩码。 */
  apiKey: string
  language: PageAgentLanguage
  /** 单任务最大步数。 */
  maxSteps: number
  /** 步与步之间的间隔（秒）。 */
  stepDelay: number
  /** 模型调用重试次数。 */
  maxRetries: number
  /** 去掉 tool_choice 的具名形式（部分网关不认）。 */
  disableNamedToolChoice: boolean
  /** 合并进请求体的额外字段（各家网关的私有开关），JSON 对象。 */
  extraBody: Record<string, unknown>
  /** 单次模型调用超时（毫秒）。 */
  requestTimeoutMs: number
  enableMask: boolean
  promptForNextTask: boolean
  panel: PanelStyle
  entry: EntryStyle
  panelPolicy: PanelPolicy
  /** 允许运行助手的路径前缀；空数组 = 全站。 */
  allowPaths: string[]
  routeInstructions: RouteInstruction[]
  maskRules: MaskRule[]
  /** 追加在系统提示后的全局指令。 */
  systemInstructions: string
  /** 完全接管系统提示（高级用法，留空则用库内置）。 */
  customSystemPrompt: string
  /** 允许模型执行生成的 JS（有副作用风险，默认关）。 */
  experimentalScriptExecution: boolean
  /** 把站点 /llms.txt 作为上下文（默认关）。 */
  experimentalLlmsTxt: boolean
}

export const DEFAULT_PAGE_AGENT_SETTINGS: PageAgentSettings = {
  enabled: true,
  baseUrl: '',
  model: '',
  apiKey: '',
  language: 'zh-CN',
  maxSteps: 20,
  stepDelay: 0.4,
  maxRetries: 2,
  disableNamedToolChoice: false,
  extraBody: {},
  requestTimeoutMs: 90000,
  enableMask: false,
  promptForNextTask: true,
  panel: {
    width: 360,
    height: 40,
    offsetBottom: 96,
    sideSpace: 12,
    radius: 12,
    colorFrom: 'rgb(37, 99, 235)',
    colorTo: 'rgb(34, 211, 238)',
    accent: 'rgb(37, 99, 235)',
    zIndex: 2_147_483_000,
  },
  entry: {
    label: '页面助手',
    showLabel: false,
    accent: 'var(--brand)',
  },
  panelPolicy: 'auto',
  allowPaths: [],
  routeInstructions: [],
  maskRules: [
    { label: '手机号', pattern: '1[3-9]\\d{9}', replacement: '[手机号]', enabled: true },
    { label: '邮箱', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', replacement: '[邮箱]', enabled: false },
  ],
  systemInstructions: '',
  customSystemPrompt: '',
  experimentalScriptExecution: false,
  experimentalLlmsTxt: false,
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** 颜色既接受 `#rrggbb` 也接受 `rgb()/rgba()`：面板变量直接写进 CSS。 */
function paint(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  if (/^rgba?\([\d\s.,%]+\)$/.test(text)) return text
  return fallback
}

function text(value: unknown, fallback = '', max = 2000): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringList(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

function routeInstructions(value: unknown): RouteInstruction[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({ pattern: text(item.pattern, '', 300), instruction: text(item.instruction, '', 2000) }))
    .filter((item) => item.pattern && item.instruction)
    .slice(0, 40)
}

function maskRules(value: unknown, fallback: MaskRule[]): MaskRule[] {
  if (!Array.isArray(value)) return fallback
  const rules = value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      label: text(item.label, '规则', 40),
      pattern: text(item.pattern, '', 300),
      replacement: text(item.replacement, '***', 60),
      enabled: bool(item.enabled, true),
    }))
    .filter((item) => item.pattern)
  // 允许清空：用户把规则删完就是「不脱敏」，不要偷偷塞回默认规则。
  return rules.slice(0, 40)
}

function extraBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 30)
  return Object.fromEntries(entries)
}

function panelStyle(value: unknown, base: PanelStyle): PanelStyle {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PanelStyle>
  return {
    width: clampInt(raw.width, 240, 720, base.width),
    height: clampInt(raw.height, 32, 120, base.height),
    offsetBottom: clampInt(raw.offsetBottom, 0, 800, base.offsetBottom),
    sideSpace: clampInt(raw.sideSpace, 0, 60, base.sideSpace),
    radius: clampInt(raw.radius, 0, 32, base.radius),
    colorFrom: paint(raw.colorFrom, base.colorFrom),
    colorTo: paint(raw.colorTo, base.colorTo),
    accent: paint(raw.accent, base.accent),
    zIndex: clampInt(raw.zIndex, 1, 2_147_483_647, base.zIndex),
  }
}

/** 入口强调色既允许 CSS 变量也允许具体色值，因此不做过严校验。 */
function cssColor(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > 60) return fallback
  if (/^var\(--[\w-]+\)$/.test(text)) return text
  return paint(text, fallback)
}

function entryStyle(value: unknown, base: EntryStyle): EntryStyle {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<EntryStyle>
  return {
    label: text(raw.label, base.label, 24) || base.label,
    showLabel: bool(raw.showLabel, base.showLabel),
    accent: cssColor(raw.accent, base.accent),
  }
}

/** 把任意输入收敛成合法设置：字段缺失沿用 `base`，非法值回落默认。 */
export function normalizeSettings(input: unknown, base: PageAgentSettings = DEFAULT_PAGE_AGENT_SETTINGS): PageAgentSettings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<PageAgentSettings>
  return {
    enabled: bool(raw.enabled, base.enabled),
    baseUrl: text(raw.baseUrl, base.baseUrl, 400).replace(/\/$/, ''),
    model: text(raw.model, base.model, 120),
    apiKey: text(raw.apiKey, base.apiKey, 400),
    language: raw.language === 'en-US' ? 'en-US' : 'zh-CN',
    maxSteps: clampInt(raw.maxSteps, 1, 100, base.maxSteps),
    stepDelay: clampFloat(raw.stepDelay, 0, 10, base.stepDelay),
    maxRetries: clampInt(raw.maxRetries, 0, 5, base.maxRetries),
    disableNamedToolChoice: bool(raw.disableNamedToolChoice, base.disableNamedToolChoice),
    extraBody: raw.extraBody === undefined ? base.extraBody : extraBody(raw.extraBody),
    requestTimeoutMs: clampInt(raw.requestTimeoutMs, 5000, 300000, base.requestTimeoutMs),
    enableMask: bool(raw.enableMask, base.enableMask),
    promptForNextTask: bool(raw.promptForNextTask, base.promptForNextTask),
    panel: panelStyle(raw.panel, base.panel),
    entry: entryStyle(raw.entry, base.entry),
    panelPolicy: raw.panelPolicy === 'always' || raw.panelPolicy === 'none' ? raw.panelPolicy : 'auto',
    allowPaths: raw.allowPaths === undefined ? base.allowPaths : stringList(raw.allowPaths),
    routeInstructions: raw.routeInstructions === undefined ? base.routeInstructions : routeInstructions(raw.routeInstructions),
    maskRules: raw.maskRules === undefined ? base.maskRules : maskRules(raw.maskRules, base.maskRules),
    systemInstructions: text(raw.systemInstructions, base.systemInstructions, 4000),
    customSystemPrompt: text(raw.customSystemPrompt, base.customSystemPrompt, 20000),
    experimentalScriptExecution: bool(raw.experimentalScriptExecution, base.experimentalScriptExecution),
    experimentalLlmsTxt: bool(raw.experimentalLlmsTxt, base.experimentalLlmsTxt),
  }
}

/**
 * 环境变量播种：只在存储里还没有设置时生效，之后界面是唯一真源。
 *
 * `PAGE_AGENT_*` 未配置时回落到同一台网关的 `AI_*`（AI 插件已经在用这套），
 * 这样部署 `.env` 里那把密钥只写一次，不需要为两个插件各存一份。
 * 回落只发生在播种阶段；界面保存之后就以存储为准，不再看环境变量。
 */
export function seedSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): PageAgentSettings {
  const baseUrl = env.PAGE_AGENT_BASE_URL?.trim() || env.AI_BASE_URL?.trim() || ''
  return normalizeSettings({
    baseUrl: baseUrl ? `${baseUrl.replace(/\/$/, '')}/v1`.replace(/\/v1\/v1$/, '/v1') : '',
    model: env.PAGE_AGENT_MODEL?.trim() || env.AI_MODEL?.trim() || '',
    apiKey: env.PAGE_AGENT_API_KEY?.trim() || env.AI_API_KEY?.trim() || '',
    enabled: env.PAGE_AGENT_ENABLED === 'false' ? false : undefined,
  })
}

/**
 * 入口视图：免登录可见的最小集合。
 *
 * 只回答「要不要显示、显示成什么样」，不含供应商地址、模型、提示词、
 * 脱敏规则这些内部信息——匿名访客拿不到任何可用于探测网关的东西。
 */
export interface EntryView {
  enabled: boolean
  /** 是否已具备运行条件（供应商 + 密钥齐备）。 */
  ready: boolean
  language: PageAgentLanguage
  panel: PanelStyle
  entry: EntryStyle
  panelPolicy: PanelPolicy
  allowPaths: string[]
}

export function entryView(settings: PageAgentSettings): EntryView {
  return {
    enabled: settings.enabled,
    ready: Boolean(settings.enabled && settings.baseUrl && settings.model && settings.apiKey),
    language: settings.language,
    panel: settings.panel,
    entry: settings.entry,
    panelPolicy: settings.panelPolicy,
    allowPaths: settings.allowPaths,
  }
}

/** 可编辑设置的下发形状：与存储字段一一对应，不含任何密钥信息。 */
export interface EditablePageAgentSettings {
  enabled: boolean
  baseUrl: string
  model: string
  language: PageAgentLanguage
  maxSteps: number
  stepDelay: number
  maxRetries: number
  disableNamedToolChoice: boolean
  extraBody: Record<string, unknown>
  requestTimeoutMs: number
  enableMask: boolean
  promptForNextTask: boolean
  panel: PanelStyle
  entry: EntryStyle
  panelPolicy: PanelPolicy
  allowPaths: string[]
  routeInstructions: RouteInstruction[]
  maskRules: MaskRule[]
  systemInstructions: string
  customSystemPrompt: string
  experimentalScriptExecution: boolean
  experimentalLlmsTxt: boolean
}

/** 后端下发的设置视图：可编辑字段 + 密钥状态（**永不回传明文**）。 */
export interface PublicPageAgentSettings extends EditablePageAgentSettings {
  /** 是否已配置密钥。 */
  hasApiKey: boolean
  /** 密钥末四位，用于「是不是这把钥匙」的确认，不足以还原。 */
  apiKeyHint: string
  /** 供应商是否齐备（baseUrl + model + key）。 */
  ready: boolean
  /** 代理路径：浏览器把模型调用发到这里，密钥不出后端。 */
  proxyPath: string
  /** 后端默认值（唯一的默认值来源），供界面「恢复默认值」使用。 */
  defaults: EditablePageAgentSettings
}

/** 视图投影：把一份设置摊平成「可下发、无密钥」的形状。 */
function project(settings: PageAgentSettings): EditablePageAgentSettings {
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    model: settings.model,
    language: settings.language,
    maxSteps: settings.maxSteps,
    stepDelay: settings.stepDelay,
    maxRetries: settings.maxRetries,
    disableNamedToolChoice: settings.disableNamedToolChoice,
    extraBody: settings.extraBody,
    requestTimeoutMs: settings.requestTimeoutMs,
    enableMask: settings.enableMask,
    promptForNextTask: settings.promptForNextTask,
    panel: settings.panel,
    entry: settings.entry,
    panelPolicy: settings.panelPolicy,
    allowPaths: settings.allowPaths,
    routeInstructions: settings.routeInstructions,
    maskRules: settings.maskRules,
    systemInstructions: settings.systemInstructions,
    customSystemPrompt: settings.customSystemPrompt,
    experimentalScriptExecution: settings.experimentalScriptExecution,
    experimentalLlmsTxt: settings.experimentalLlmsTxt,
  }
}

export function publicSettings(settings: PageAgentSettings): PublicPageAgentSettings {
  const key = settings.apiKey
  return {
    ...project(settings),
    hasApiKey: key.length > 0,
    apiKeyHint: key.length >= 4 ? `…${key.slice(-4)}` : '',
    ready: Boolean(settings.enabled && settings.baseUrl && settings.model && key),
    proxyPath: '/page-agent/llm',
    // 默认值随设置一起下发：界面「恢复默认值」与后端回落用的是同一份，
    // 浏览器不再自带第二份默认值表（改默认只需改 `DEFAULT_PAGE_AGENT_SETTINGS`）。
    defaults: project(DEFAULT_PAGE_AGENT_SETTINGS),
  }
}

export interface SettingsStore {
  read(): PageAgentSettings
  write(input: unknown): PageAgentSettings
}

/** 设置读写：存储里没有时用环境变量播种，但**不写回**（避免把密钥落成第二份）。 */
export function createSettingsStore(options: { kv: KeyValueStore; env?: NodeJS.ProcessEnv }): SettingsStore {
  const env = options.env ?? process.env
  const seed = seedSettingsFromEnv(env)

  const read = (): PageAgentSettings => normalizeSettings(options.kv.get<PageAgentSettings>(SETTINGS_KEY), seed)

  return {
    read,
    write(input: unknown) {
      const current = read()
      const next = normalizeSettings(input, current)
      options.kv.set(SETTINGS_KEY, next)
      return next
    },
  }
}
