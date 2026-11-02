// 页面助手的设置贡献：把原先的独立设置页改成一个设置区。
//
// 每一项都是声明式字段（类型、必填、范围、提示），控件与校验由系统设置页统一渲染；
// 密钥仍然只存后端——`load` 只下发 `hasApiKey` / 末四位提示，`apiKey` 留空即沿用。
import { ElMessageBox } from 'element-plus'
import type { SettingField, SettingSectionContribution, SettingValues } from '@/kernel'
import type { HttpClient } from '@/shared/http'
import {
  clearPageAgentKey,
  fetchPageAgentSettings,
  probePageAgent,
  savePageAgentSettings,
  type EditablePageAgentSettings,
  type PageAgentSettingsView,
} from './api'
import type { PageAgentRuntime } from './runtime'

/** 可写字段（顺序即保存 payload 的键集合）；`hasApiKey` 这类视图状态不下发。 */
const EDITABLE_KEYS: Array<keyof EditablePageAgentSettings> = [
  'enabled',
  'baseUrl',
  'model',
  'language',
  'maxSteps',
  'stepDelay',
  'maxRetries',
  'disableNamedToolChoice',
  'extraBody',
  'requestTimeoutMs',
  'enableMask',
  'promptForNextTask',
  'panel',
  'entry',
  'panelPolicy',
  'allowPaths',
  'routeInstructions',
  'maskRules',
  'systemInstructions',
  'customSystemPrompt',
  'experimentalScriptExecution',
  'experimentalLlmsTxt',
]

const blocks = [
  { id: 'model', title: '模型连接', description: 'OpenAI 兼容网关；请求由后端转发，密钥不会出现在浏览器里' },
  { id: 'runtime', title: '运行行为', description: '影响执行成本与副作用，逐项可调' },
  { id: 'panel', title: '面板与入口', description: '全站只保留顶栏一个入口；尺寸、配色、层级都是参数，保存后立即生效' },
  { id: 'scope', title: '路径与指令', description: '限定助手能在哪些页面运行，以及同一句话在不同页面补充什么上下文' },
  { id: 'safety', title: '脱敏与提示词', description: '发送给模型前替换敏感信息；系统提示可追加或整段接管' },
]

const fields: SettingField[] = [
  // ---- 模型连接 ----
  {
    key: 'baseUrl',
    block: 'model',
    label: '供应商地址',
    type: 'text',
    required: true,
    pattern: '^https?://',
    patternMessage: '需要以 http:// 或 https:// 开头',
    placeholder: 'https://网关地址/v1',
    hint: 'OpenAI 兼容地址（含 /v1），例如 https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    key: 'model',
    block: 'model',
    label: '模型',
    type: 'text',
    required: true,
    placeholder: '例如 ds / gpt-6-astra',
    hint: '需要支持 function/tool calling，否则助手无法操作页面',
  },
  {
    key: 'apiKey',
    block: 'model',
    label: 'API 密钥',
    type: 'secret',
    required: (values) => !values.hasApiKey,
    placeholder: (values) => (values.hasApiKey ? `已保存 ${String(values.apiKeyHint ?? '')}，留空即沿用` : '粘贴供应商密钥'),
    hint: (values) => (values.hasApiKey ? '密钥只存服务端；留空保存表示沿用，清空请用下方「清空密钥」' : '密钥只存服务端，浏览器只拿到掩码'),
  },
  {
    key: 'requestTimeoutMs',
    block: 'model',
    label: '单次调用超时（毫秒）',
    type: 'number',
    required: true,
    min: 5000,
    max: 300000,
    step: 5000,
  },
  {
    key: 'maxRetries',
    block: 'model',
    label: '失败重试次数',
    type: 'number',
    required: true,
    min: 0,
    max: 5,
    step: 1,
  },
  {
    key: 'language',
    block: 'model',
    label: '面板语言',
    type: 'select',
    options: [
      { value: 'zh-CN', label: '中文' },
      { value: 'en-US', label: 'English' },
    ],
  },
  {
    key: 'extraBody',
    block: 'model',
    label: '额外请求体（JSON）',
    type: 'json',
    hint: '合并进每次请求，用于网关私有开关，例如 {"enable_thinking": false}；留空表示不加',
  },
  {
    key: 'disableNamedToolChoice',
    block: 'model',
    label: '具名 tool_choice 降级',
    type: 'switch',
    hint: '部分网关不认 {"type":"function"} 形式的 tool_choice；打开后只发 required',
  },

  // ---- 运行行为 ----
  {
    key: 'maxSteps',
    block: 'runtime',
    label: '最大步数',
    type: 'number',
    required: true,
    min: 1,
    max: 100,
    step: 1,
    hint: '单任务最多交互几步；步数越多越可能跑偏，也越费 token',
  },
  {
    key: 'stepDelay',
    block: 'runtime',
    label: '步间隔（秒）',
    type: 'number',
    required: true,
    min: 0,
    max: 10,
    step: 0.1,
    precision: 1,
    hint: '给页面渲染留时间，SPA 页面建议 0.5 以上',
  },
  {
    key: 'panelPolicy',
    block: 'runtime',
    label: '面板出现时机',
    type: 'select',
    options: [
      { value: 'auto', label: '任务时展开' },
      { value: 'always', label: '常驻展开' },
      { value: 'none', label: '不显示面板（静默执行）' },
    ],
  },
  { key: 'enabled', block: 'runtime', label: '总开关', type: 'switch', hint: '关掉后顶栏入口不出现、代理拒绝调用' },
  { key: 'enableMask', block: 'runtime', label: '操作遮罩', type: 'switch', hint: '执行时遮住页面防误触；调试阶段建议关掉' },
  { key: 'promptForNextTask', block: 'runtime', label: '任务后继续提问', type: 'switch', hint: '完成后保留输入框，可直接接下一句指令' },
  {
    key: 'experimentalScriptExecution',
    block: 'runtime',
    label: '允许执行生成的 JS',
    type: 'switch',
    hint: '实验能力，可能绕过脱敏与安全限制，默认关闭',
  },
  {
    key: 'experimentalLlmsTxt',
    block: 'runtime',
    label: '读取站点 /llms.txt',
    type: 'switch',
    hint: '实验能力，给模型补充站点说明，默认关闭',
  },

  // ---- 面板与入口 ----
  { key: 'panel.width', block: 'panel', label: '面板宽度（px）', type: 'number', required: true, min: 240, max: 720, step: 20 },
  { key: 'panel.height', block: 'panel', label: '收起高度（px）', type: 'number', required: true, min: 32, max: 120, step: 2 },
  { key: 'panel.offsetBottom', block: 'panel', label: '距底部（px）', type: 'number', required: true, min: 0, max: 800, step: 8 },
  { key: 'panel.sideSpace', block: 'panel', label: '距侧边（px）', type: 'number', required: true, min: 0, max: 200, step: 4 },
  { key: 'panel.radius', block: 'panel', label: '圆角（px）', type: 'number', required: true, min: 0, max: 40, step: 2 },
  { key: 'panel.colorFrom', block: 'panel', label: '面板渐变起点', type: 'color', required: true },
  { key: 'panel.colorTo', block: 'panel', label: '面板渐变终点', type: 'color', required: true },
  { key: 'panel.accent', block: 'panel', label: '面板强调色', type: 'color', required: true },
  { key: 'entry.label', block: 'panel', label: '入口文案', type: 'text', required: true, hint: '顶栏空间不足时只显示图标，文案进 tooltip' },
  { key: 'entry.showLabel', block: 'panel', label: '入口显示文案', type: 'switch' },
  {
    key: 'entry.accent',
    block: 'panel',
    label: '入口强调色',
    type: 'text',
    required: true,
    mono: true,
    hint: '可写 CSS 变量（如 var(--brand)）或十六进制颜色',
  },

  // ---- 路径与指令 ----
  {
    key: 'allowPaths',
    block: 'scope',
    label: '允许运行的路径前缀',
    type: 'tags',
    placeholder: '输入 /system 后回车添加',
    hint: '空列表 = 全站可运行；只填前缀，例如 /system',
  },
  {
    key: 'routeInstructions',
    block: 'scope',
    label: '按路径的附加指令',
    type: 'records',
    columns: [
      { key: 'pattern', label: '路径前缀或 re: 正则', type: 'text', mono: true },
      { key: 'instruction', label: '附加指令', type: 'textarea' },
    ],
  },

  // ---- 脱敏与提示词 ----
  {
    key: 'maskRules',
    block: 'safety',
    label: '脱敏规则',
    type: 'records',
    columns: [
      { key: 'label', label: '名称', type: 'text' },
      { key: 'pattern', label: '正则', type: 'text', mono: true },
      { key: 'replacement', label: '替换为', type: 'text' },
      { key: 'enabled', label: '启用', type: 'switch' },
    ],
  },
  {
    key: 'systemInstructions',
    block: 'safety',
    label: '全局补充指令',
    type: 'textarea',
    rows: 4,
    placeholder: '例如：本系统为工控后台，删除操作必须二次确认；不要自行提交表单。',
    hint: '追加在库内置系统提示之后，用来交代本后台的术语与禁忌',
  },
  {
    key: 'customSystemPrompt',
    block: 'safety',
    label: '完全接管系统提示（高级）',
    type: 'textarea',
    rows: 4,
    mono: true,
    placeholder: '留空即使用内置提示',
    hint: '填入后整段替换内置提示；写错会让助手失效',
  },
]

export interface PageAgentSettingsDeps {
  http: HttpClient
  runtime: PageAgentRuntime
}

/** 把视图转成可编辑值：深拷贝，避免表单直接改到 runtime 持有的对象。 */
function valuesOf(view: PageAgentSettingsView): SettingValues {
  return JSON.parse(JSON.stringify(view)) as SettingValues
}

export function createPageAgentSettings(deps: PageAgentSettingsDeps): SettingSectionContribution {
  const { http, runtime } = deps
  /** 最近一次读取的视图：恢复默认值要用后端下发的 `defaults`，不在浏览器写第二份。 */
  let lastView: PageAgentSettingsView | null = null

  async function load(): Promise<SettingValues> {
    const view = await fetchPageAgentSettings(http)
    lastView = view
    return valuesOf(view)
  }

  return {
    id: 'page-agent:settings',
    group: { id: 'assistant', title: '页面助手', order: 20, icon: 'MagicStick' },
    title: '页面助手',
    description:
      '把 alibaba/page-agent 装进本后台：用自然语言操作当前页面。模型地址与密钥都留在服务端，浏览器只经同源代理调用。',
    order: 10,
    permission: 'system:page-agent:config',
    blocks,
    fields,
    load,
    async save(values) {
      const payload: Record<string, unknown> = {}
      for (const key of EDITABLE_KEYS) payload[key] = values[key]
      const apiKey = typeof values.apiKey === 'string' ? values.apiKey.trim() : ''
      const view = await savePageAgentSettings(http, {
        ...(payload as unknown as Partial<PageAgentSettingsView>),
        ...(apiKey ? { apiKey } : {}),
      })
      lastView = view
      await runtime.reload()
      return '已保存，下一次任务立即生效（浏览器不会拿到密钥）'
    },
    defaults() {
      const view = lastView
      if (!view) return {}
      // 默认值只来自后端下发的 `defaults`；浏览器只补回「密钥仍存在」这类视图状态。
      const defaults = valuesOf({ ...view, ...view.defaults } as PageAgentSettingsView)
      return {
        ...defaults,
        apiKey: '',
        hasApiKey: view.hasApiKey,
        apiKeyHint: view.apiKeyHint,
        defaults: view.defaults,
      } as SettingValues
    },
    actions: [
      {
        id: 'probe',
        label: '连接自检',
        icon: 'Connection',
        async run() {
          const result = await probePageAgent(http)
          if (!result.ok) throw new Error(result.message)
          return `连接正常（${result.elapsedMs} ms）`
        },
      },
      {
        id: 'demo',
        label: '在当前页面试跑',
        icon: 'VideoPlay',
        async run() {
          await runtime.run('描述当前页面有哪些主要功能区块，并指出「保存」按钮在哪')
          return '已发送试跑指令'
        },
      },
      {
        id: 'open',
        label: '打开面板',
        icon: 'Promotion',
        async run() {
          await runtime.open()
        },
      },
      {
        id: 'clear-key',
        label: '清空密钥',
        icon: 'Delete',
        kind: 'danger',
        visible: (values) => Boolean(values.hasApiKey),
        async run() {
          try {
            await ElMessageBox.confirm('清空后助手会立即不可用，直到重新填写密钥。确定清空？', '清空 API 密钥', {
              type: 'warning',
            })
          } catch {
            return
          }
          const view = await clearPageAgentKey(http)
          lastView = view
          await runtime.reload()
          return '已清空密钥'
        },
        reloadAfter: true,
      },
    ],
  }
}
