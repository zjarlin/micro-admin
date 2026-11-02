// 页面助手（PageAgent）插件（服务端）。
//
// 只做两件事，都不认识 Vue：
// 1. `/page-agent/settings` —— 设置的读（公开视图）与写（需权限码）；
// 2. `/page-agent/llm` —— OpenAI 兼容代理，浏览器拿不到密钥。
//
// 设置与密钥都在 SQLite（`ui_kv`）里，界面改了立即生效，不需要发版；
// 环境变量只在存储为空时播种一次（`PAGE_AGENT_*`，见 deploy/.env）。
import type { ExtensionRequest, KeyValueStore } from '@zjarlin/ui-server'
import {
  PAGE_AGENT_CONFIG_PERMISSION,
  createSettingsStore,
  entryView,
  publicSettings,
  type PageAgentSettings,
} from './settings.ts'
import { invokeUpstream, probeUpstream } from './proxy.ts'

export const UNHANDLED = Symbol('page-agent-unhandled')
export const LLM_PATH = '/page-agent/llm'

export interface PageAgentPlugin {
  handle(request: ExtensionRequest): Promise<unknown> | unknown | typeof UNHANDLED
}

export interface PageAgentPluginOptions {
  kv: KeyValueStore
  /** 覆盖环境变量来源（测试/多环境）。 */
  env?: NodeJS.ProcessEnv
}

function allowed(user: ExtensionRequest['user'], permission: string): boolean {
  if (!user) return false
  return user.permissions.includes('*:*:*') || user.permissions.includes('*') || user.permissions.includes(permission)
}

function pagePathOf(request: ExtensionRequest): string {
  const fromQuery = request.query.get('page') ?? ''
  const fromHeaderLike = request.query.get('path') ?? ''
  return (fromQuery || fromHeaderLike || '').trim()
}

export function createPageAgentPlugin(options: PageAgentPluginOptions): PageAgentPlugin {
  const store = createSettingsStore({ kv: options.kv, ...(options.env ? { env: options.env } : {}) })

  return {
    async handle(request: ExtensionRequest) {
      const { method, path } = request
      const user = request.user

      // ---------------- 模型代理 ----------------
      // 库自己会在 baseURL 后拼 `/chat/completions`（见 @page-agent/llms），
      // 因此两种形状都收：`/page-agent/llm` 与 `/page-agent/llm/chat/completions`。
      const isLlmPath = path === LLM_PATH
        || path === `${LLM_PATH}/chat/completions`
        || path === `${LLM_PATH}/`
      if (isLlmPath && method === 'POST') {
        const payload = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>
        const outcome = await invokeUpstream(store.read(), payload, { pagePath: pagePathOf(request) })
        if (outcome.status !== 200) {
          // 代理错误原样透出 HTTP 状态，前端能区分「未配置」「被白名单拦」「供应商限流」。
          const body = outcome.body as { error?: { message?: string } }
          throw Object.assign(new Error(body.error?.message ?? '模型调用失败'), { status: outcome.status })
        }
        return outcome.body
      }

      // ---------------- 顶栏入口视图（免登录，仅外观与可见性）----------------
      if (path === '/page-agent/entry' && method === 'GET') {
        return entryView(store.read())
      }

      // ---------------- 设置 ----------------
      if (path === '/page-agent/settings' && method === 'GET') {
        // 内部信息（供应商地址、模型、提示词、脱敏规则）只给登录用户。
        if (!user) throw Object.assign(new Error('登录后才能读取页面助手设置'), { status: 401 })
        return publicSettings(store.read())
      }

      if (path === '/page-agent/settings' && (method === 'PUT' || method === 'POST')) {
        if (!allowed(user, PAGE_AGENT_CONFIG_PERMISSION)) {
          throw Object.assign(new Error(`缺少页面助手配置权限：${PAGE_AGENT_CONFIG_PERMISSION}`), { status: 403 })
        }
        const input = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Partial<PageAgentSettings>
        // 密钥留空 = 保留原值：界面永远拿不到明文，也就不该因为没重填而清空。
        const current = store.read()
        const next = input.apiKey === undefined || input.apiKey === null || input.apiKey === ''
          ? { ...input, apiKey: current.apiKey }
          : input
        return publicSettings(store.write(next))
      }

      // 显式清空密钥（与「密钥留空保留」区分开）。
      if (path === '/page-agent/settings/api-key' && method === 'DELETE') {
        if (!allowed(user, PAGE_AGENT_CONFIG_PERMISSION)) {
          throw Object.assign(new Error(`缺少页面助手配置权限：${PAGE_AGENT_CONFIG_PERMISSION}`), { status: 403 })
        }
        return publicSettings(store.write({ ...store.read(), apiKey: '' }))
      }

      // ---------------- 连通性自检 ----------------
      if (path === '/page-agent/probe' && method === 'POST') {
        if (!allowed(user, PAGE_AGENT_CONFIG_PERMISSION)) {
          throw Object.assign(new Error(`缺少页面助手配置权限：${PAGE_AGENT_CONFIG_PERMISSION}`), { status: 403 })
        }
        return probeUpstream(store.read())
      }

      return UNHANDLED
    },
  }
}
