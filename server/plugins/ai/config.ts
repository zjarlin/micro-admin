// AI 接入配置：优先环境变量，其次读本机 Codex 配置（~/.codex/config.toml + auth.json）。
//
// 为什么要读 Codex 配置：182 上的模型入口就是 Codex 用的那个网关（sub2api，本地 18080），
// 同一份 provider/base_url/密钥已经在那儿维护好了，再手抄一遍必然漂移。
// 部署到别的机器时用环境变量覆盖即可，不依赖 Codex 存在。
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AiConfig {
  /** 配置来源：env（显式设置）/ codex（读本机配置）/ none（没配好）。 */
  source: 'env' | 'codex' | 'none'
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  /** 单次调用超时（毫秒）。 */
  timeoutMs: number
  ready: boolean
}

interface CodexConfigFile {
  model: string
  provider: string
  providers: Record<string, { baseUrl: string; name: string }>
}

/** 极简 TOML 读取：只认 `[section]` 与 `key = "value"`，足够读 Codex 的 provider 段。 */
function readCodexToml(path: string): CodexConfigFile {
  const result: CodexConfigFile = { model: '', provider: '', providers: {} }
  if (!existsSync(path)) return result
  let section = ''
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const heading = line.match(/^\[(.+)]$/)
    if (heading) {
      section = (heading[1] ?? '').trim()
      continue
    }
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!pair) continue
    const key = pair[1] ?? ''
    const value = (pair[2] ?? '').trim().replace(/^"|"$/g, '')
    if (!section) {
      if (key === 'model') result.model = value
      else if (key === 'model_provider') result.provider = value
      continue
    }
    const provider = section.match(/^model_providers\.([^.]+)$/)
    if (!provider) continue
    const name = provider[1] ?? ''
    const entry = result.providers[name] ?? { baseUrl: '', name }
    if (key === 'base_url') entry.baseUrl = value
    if (key === 'name') entry.name = value
    result.providers[name] = entry
  }
  return result
}

/** 从 Codex 的 auth.json 里挑一个可用的 API Key（按 provider 名猜，最后兜底任意 API_KEY）。 */
function pickApiKey(authPath: string, provider: string): string {
  if (!existsSync(authPath)) return ''
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    const lowered = provider.toLowerCase()
    const preferred = lowered.includes('anthropic')
      ? ['ANTHROPICAI_CC_API_KEY', 'ANTHROPIC_API_KEY']
      : ['OPENAI_API_KEY']
    for (const key of preferred) {
      const value = auth[key]
      if (typeof value === 'string' && value) return value
    }
    for (const [key, value] of Object.entries(auth)) {
      if (key.endsWith('API_KEY') && typeof value === 'string' && value) return value
    }
  } catch {
    return ''
  }
  return ''
}

export interface LoadAiConfigOptions {
  env?: NodeJS.ProcessEnv
  /** Codex 配置目录，默认 `$CODEX_HOME` 或 `~/.codex`。 */
  codexHome?: string
}

/**
 * 解析 AI 配置。
 *
 * 优先级：`AI_*` 环境变量 > Codex 配置。任一环节缺失都会让 `ready=false`，
 * 界面据此显示「未配置」而不是等到调用时抛 500。
 */
export function loadAiConfig(options: LoadAiConfigOptions = {}): AiConfig {
  const env = options.env ?? process.env
  const codexHome = options.codexHome ?? env.CODEX_HOME ?? join(homedir(), '.codex')
  const codex = readCodexToml(join(codexHome, 'config.toml'))
  const providerEntry = codex.providers[codex.provider]

  const envBaseUrl = env.AI_BASE_URL?.trim() ?? ''
  const envApiKey = env.AI_API_KEY?.trim() ?? ''
  const baseUrl = envBaseUrl || providerEntry?.baseUrl || 'http://127.0.0.1:18080'
  const provider = env.AI_PROVIDER?.trim() || codex.provider || providerEntry?.name || 'codex'
  const apiKey = envApiKey || pickApiKey(join(codexHome, 'auth.json'), provider)
  const model = env.AI_MODEL?.trim() || codex.model || 'ds'
  const timeoutMs = Number(env.AI_TIMEOUT_MS ?? 120000) || 120000

  const source: AiConfig['source'] = envBaseUrl || envApiKey ? 'env' : apiKey ? 'codex' : 'none'
  return {
    source,
    provider,
    model,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    timeoutMs,
    ready: Boolean(baseUrl && apiKey && model),
  }
}

/** 对外暴露的配置视图：绝不带密钥。 */
export function publicAiConfig(config: AiConfig): Record<string, unknown> {
  return {
    ready: config.ready,
    source: config.source,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  }
}
