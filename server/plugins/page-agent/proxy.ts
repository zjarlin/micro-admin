// 模型代理：浏览器端的 PageAgent 只把请求发到这里，真正的密钥留在服务端。
//
// 为什么必须代理而不是把 key 塞进浏览器：PageAgent 是「在页面里跑」的库，
// 若直连供应商，密钥会出现在 DevTools/Network 里，任何登录用户都能抄走。
// 走同源代理后浏览器既拿不到密钥，也拿不到供应商地址以外的任何信息。
import type { PageAgentSettings } from './settings.ts'

export interface ProxyOutcome {
  status: number
  /** 直接回给浏览器的 JSON（OpenAI 兼容形状）。 */
  body: unknown
  /** 便于「最近调用」面板展示的摘要。 */
  meta: { model: string; ok: boolean; elapsedMs: number; usage: Record<string, unknown> | null }
}

function redactUpstream(text: string): string {
  // 上游错误里可能回显 key 片段；统一砍掉，避免顺着报错泄露。
  return text.replace(/(sk-[A-Za-z0-9_-]{4,})/g, 'sk-***').slice(0, 600)
}

function describeError(status: number, body: string): string {
  if (status === 401 || status === 403) return `供应商鉴权失败（${status}）：请检查密钥与模型权限`
  if (status === 404) return `供应商接口或模型不存在（404）：核对 baseUrl 是否带 /v1、模型是否已开通`
  if (status === 429) return `供应商限流（429）：稍后重试或换模型`
  if (status >= 500) return `供应商异常（${status}）`
  return `模型调用失败（${status}）：${redactUpstream(body)}`
}

export interface InvokeOptions {
  /** 调用方页面路径，用于「允许路径」白名单。 */
  pagePath?: string
}

function pathAllowed(settings: PageAgentSettings, pagePath: string): boolean {
  if (settings.allowPaths.length === 0) return true
  if (!pagePath) return false
  return settings.allowPaths.some((prefix) => pagePath === prefix || pagePath.startsWith(prefix))
}

/**
 * 转发一次 chat/completions。
 *
 * 请求体由浏览器构造（PageAgent 自己拼 messages/tools），这里只做四件事：
 * 校验开关与白名单、注入密钥与私有字段、套超时、把错误翻成可读文案。
 */
export async function invokeUpstream(
  settings: PageAgentSettings,
  payload: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<ProxyOutcome> {
  const started = Date.now()
  const model = settings.model
  const fail = (status: number, message: string): ProxyOutcome => ({
    status,
    body: { error: { message, type: 'page_agent_proxy_error' } },
    meta: { model, ok: false, elapsedMs: Date.now() - started, usage: null },
  })

  if (!settings.enabled) return fail(409, '页面助手已停用：在「页面助手」设置里打开总开关')
  if (!settings.baseUrl || !settings.model || !settings.apiKey) {
    return fail(503, '页面助手未配置完整：需要 baseUrl、模型与密钥')
  }
  if (!pathAllowed(settings, options.pagePath ?? '')) {
    return fail(403, `当前页面（${options.pagePath || '未知'}）不在允许运行助手的路径白名单内`)
  }

  // 浏览器不允许覆盖这些字段，否则等于绕过上面的校验。
  const body: Record<string, unknown> = {
    ...settings.extraBody,
    ...payload,
    model: settings.model,
    stream: false,
  }

  let response: Response
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(reason))
    return fail(timedOut ? 504 : 502, timedOut
      ? `模型调用超时（${Math.round(settings.requestTimeoutMs / 1000)}s）：可在设置里放宽超时或减少步数`
      : `连不上模型网关：${reason}`)
  }

  const rawText = await response.text()
  if (!response.ok) return fail(response.status, describeError(response.status, rawText))

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return fail(502, '供应商返回的不是 JSON：核对 baseUrl 是否指到 OpenAI 兼容接口')
  }

  const usage = (parsed as { usage?: Record<string, unknown> } | null)?.usage ?? null
  return {
    status: 200,
    body: parsed,
    meta: { model, ok: true, elapsedMs: Date.now() - started, usage },
  }
}

/** 连通性自检：只发一句最短的话，不消耗工具调用预算。 */
export async function probeUpstream(settings: PageAgentSettings): Promise<{ ok: boolean; message: string; elapsedMs: number }> {
  const started = Date.now()
  const outcome = await invokeUpstream(
    { ...settings, enabled: true, allowPaths: [] },
    {
      messages: [{ role: 'user', content: 'reply with the single word: pong' }],
      max_tokens: 16,
    },
  )
  const elapsedMs = Date.now() - started
  if (outcome.status !== 200) {
    const body = outcome.body as { error?: { message?: string } }
    return { ok: false, message: body.error?.message ?? '自检失败', elapsedMs }
  }
  const content = (outcome.body as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content
  return { ok: true, message: `供应商可用（${settings.model}）：${String(content ?? '').slice(0, 60) || '空回复'}`, elapsedMs }
}
