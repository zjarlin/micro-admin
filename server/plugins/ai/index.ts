// AI 插件（服务端）：提示词库 + 组态指令生成 + 通用对话。
//
// 边界：这里只负责「模型能干什么」，不认识 Vue、不认识画布组件。
// 画布把当前文档发进来，服务端跑一遍指令集，把「改好的文档 + 逐行问题」还回去，
// 前端只做预览/确认，不参与任何几何计算——同一份能力换到别的编辑器也能用。
import type { ExtensionRequest, KeyValueStore } from '@addzero/ui-server'
import {
  DSL_OPS,
  REF_HELP,
  applyCommands,
  describeDocument,
  extractCodeBlock,
  layoutStats,
  opsCatalogMarkdown,
  parseCommands,
  type DslDocument,
  type DslSymbol,
  type DslTag,
} from '@addzero/scada-dsl'
import type { ScadaSymbolDefinition, ScadaTagOption } from '../../../src/shared/scada/types.ts'
import { loadAiConfig, publicAiConfig } from './config.ts'
import { respondText, type AiMessage } from './client.ts'
import { createPromptStore, type AiPrompt, type PromptScenario } from './prompts.ts'

export const UNHANDLED = Symbol('ai-unhandled')

export interface AiPluginOptions {
  kv: KeyValueStore
  /** 图元库：来自组态插件，保证 AI 与画布看到同一份能力。 */
  symbols: ScadaSymbolDefinition[]
  /** 点位目录：同上。 */
  tags: ScadaTagOption[]
  /** 覆盖 Codex 配置目录（默认 `$CODEX_HOME` 或 `~/.codex`）。 */
  codexHome?: string
}

export interface AiPlugin {
  handle(request: ExtensionRequest): Promise<unknown> | unknown | typeof UNHANDLED
}

/** 从模型回复里取一个 JSON 对象：容忍 ```json 围栏与前后解释文字。 */
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  const body = (fence?.[1] ?? text).trim()
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        /* 落到下面的统一报错 */
      }
    }
    throw Object.assign(new Error('模型没有返回合法 JSON，可再试一次或在提示词里强调「只输出 JSON」'), { status: 502 })
  }
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 图元清单：模型只需要「key、名字、默认尺寸、可绑槽位」。 */
function symbolLines(symbols: ScadaSymbolDefinition[]): string {
  return symbols.map((symbol) => {
    const slots = symbol.bindingSlots.map((slot) => slot.key).join('/')
    return `- ${symbol.key}（${symbol.name}）默认 ${symbol.defaultWidth}x${symbol.defaultHeight}${slots ? `，槽位 ${slots}` : ''}`
  }).join('\n')
}

function variableLines(tags: ScadaTagOption[]): string {
  if (tags.length === 0) return '（当前工程没有登记可绑定变量，所有 bind 指令都会被拒绝）'
  return tags.map((tag) => `- ${tag.tagId} ${tag.name}${tag.accessMode.includes('W') ? '（可写）' : ''}`).join('\n')
}

export function createAiPlugin(options: AiPluginOptions): AiPlugin {
  const config = loadAiConfig(options.codexHome ? { codexHome: options.codexHome } : {})
  const prompts = createPromptStore(options.kv)
  const dslSymbols: DslSymbol[] = options.symbols.map((symbol) => ({
    key: symbol.key,
    name: symbol.name,
    defaultWidth: symbol.defaultWidth,
    defaultHeight: symbol.defaultHeight,
    keepAspect: symbol.keepAspect,
    props: symbol.props.map((prop) => ({ key: prop.key, default: prop.default })),
    bindingSlots: symbol.bindingSlots.map((slot) => ({ key: slot.key, label: slot.label })),
  }))
  const dslTags: DslTag[] = options.tags.map((tag) => ({ tagId: tag.tagId, name: tag.name, unit: null }))

  /**
   * 绘图提示词的上下文。
   *
   * `digest` 只给 CAD 导入用：图纸已由本地解析器压成几十行摘要，模型读摘要而不是读 DXF，
   * 这是「省 token」的第二道闸门（第一道是本地解析，压根不发给模型）。
   */
  function drawContext(document: DslDocument, digest = ''): Record<string, string> {
    const stats = layoutStats(document)
    return {
      catalog: opsCatalogMarkdown(),
      digest: digest || '（本次没有图纸摘要：按当前画面自行判断）',
      refs: REF_HELP,
      document: describeDocument(document, { symbols: dslSymbols, tags: dslTags }),
      symbols: symbolLines(options.symbols),
      variables: variableLines(options.tags),
      grid: String(document.canvas.grid),
      layout: [
        stats.empty ? '画布还是空的' : '',
        stats.overflow.length ? `越界图元：${stats.overflow.join('、')}` : '没有越界图元',
        stats.overlapping.length ? `重叠：${stats.overlapping.map(([a, b]) => `${a}/${b}`).join('、')}` : '没有重叠',
        stats.empty ? '' : `内容包围盒 ${stats.bounds.width}x${stats.bounds.height}（画布 ${document.canvas.width}x${document.canvas.height}）`,
      ].filter(Boolean).join('；'),
    }
  }

  return {
    async handle(request: ExtensionRequest) {
      const { method, path, query } = request
      const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>

      if (path === '/ai/config' && method === 'GET') {
        return {
          ...publicAiConfig(config),
          prompts: prompts.list().length,
          ops: DSL_OPS.length,
        }
      }

      if (path === '/ai/catalog' && method === 'GET') {
        return { ops: DSL_OPS, markdown: opsCatalogMarkdown(), refs: REF_HELP }
      }

      // ---------------- 提示词库 ----------------
      if (path === '/ai/prompts' && method === 'GET') {
        return { items: prompts.list() }
      }

      if (path === '/ai/prompts' && method === 'POST') {
        const system = asString(body.system)
        if (!system.trim()) throw badRequest('提示词内容不能为空')
        const scenario = asString(body.scenario, 'general') as PromptScenario
        const saved = prompts.save({
          ...(asString(body.id) ? { id: asString(body.id) } : {}),
          title: asString(body.title, '未命名提示词'),
          scenario,
          description: asString(body.description),
          system,
          ...(Number.isFinite(Number(body.maxOutputTokens)) ? { maxOutputTokens: Number(body.maxOutputTokens) } : {}),
        })
        return saved
      }

      if (path.startsWith('/ai/prompts/') && method === 'DELETE') {
        const id = path.slice('/ai/prompts/'.length)
        const removed = prompts.remove(id)
        if (!removed) throw Object.assign(new Error('内置提示词不能删除，只能修改或恢复默认'), { status: 409 })
        return { removed: id }
      }

      if (path.startsWith('/ai/prompts/') && path.endsWith('/reset') && method === 'POST') {
        const id = path.slice('/ai/prompts/'.length, -'/reset'.length)
        const prompt: AiPrompt | null = prompts.reset(id)
        if (!prompt) throw Object.assign(new Error(`没有内置提示词 "${id}"`), { status: 404 })
        return prompt
      }

      // ---------------- 组态指令生成 ----------------
      if (path === '/ai/draw' && method === 'POST') {
        const prompt = asString(body.prompt).trim()
        if (!prompt) throw badRequest('缺少 prompt：描述你要画什么')
        if (prompt.length > 2000) throw badRequest('prompt 太长（上限 2000 字）')
        const document = body.document as DslDocument | undefined
        if (!document || !Array.isArray(document.widgets) || !document.canvas) {
          throw badRequest('缺少 document：需要传入当前画布文档')
        }
        const promptId = asString(body.promptId, 'scada.draw')
        const promptRecord = prompts.get(promptId)
        // 图纸摘要只可能来自 CAD 导入（前端传上来），这里不读文件、不重新解析。
        const digest = asString(body.digest).slice(0, 6000)
        const instructions = prompts.render(promptId, drawContext(document, digest))
        if (!instructions || !promptRecord) throw Object.assign(new Error(`提示词 "${promptId}" 不存在`), { status: 404 })

        const started = Date.now()
        const result = await respondText(config, {
          instructions,
          messages: [{ role: 'user', content: prompt }],
          maxOutputTokens: promptRecord.maxOutputTokens,
        })
        const commands = extractCodeBlock(result.text)
        const parsed = parseCommands(commands)
        const selection = Array.isArray(body.selection) ? body.selection.filter((id): id is string => typeof id === 'string') : []
        const applied = applyCommands(parsed.commands, {
          document,
          symbols: dslSymbols,
          tags: dslTags,
          selection,
        })
        return {
          promptId,
          model: result.model,
          elapsedMs: Date.now() - started,
          raw: result.text,
          commands,
          applied: applied.applied,
          document: applied.document,
          issues: [...parsed.issues, ...applied.issues],
          usage: result.usage,
        }
      }

      // ---------------- 原型 → 页面 schema ----------------
      if (path === '/ai/schema' && method === 'POST') {
        const prompt = asString(body.prompt).trim()
        if (!prompt) throw badRequest('缺少 prompt：描述这张原型图要做什么')
        const baseline = asString(body.baseline).slice(0, 4000)
        const promptRecord = prompts.get(asString(body.promptId, 'page.schema'))
        if (!promptRecord) throw Object.assign(new Error('提示词 "page.schema" 不存在'), { status: 404 })
        const instructions = prompts.render(promptRecord.id, { baseline: baseline || '（暂无参考页面）' })
        const result = await respondText(config, {
          instructions,
          messages: [{ role: 'user', content: prompt }],
          maxOutputTokens: promptRecord.maxOutputTokens,
        })
        let schema: Record<string, unknown>
        try {
          schema = extractJson(result.text) as Record<string, unknown>
        } catch (error) {
          console.error('[ai/schema] 非法 JSON，原始输出：', result.text.slice(0, 2000))
          throw error
        }
        if (typeof schema.key !== 'string' || !schema.key.trim()) throw Object.assign(new Error('生成的 schema 缺少 key'), { status: 502 })
        if (!Array.isArray(schema.columns) || schema.columns.length === 0) throw Object.assign(new Error('生成的 schema 缺少 columns'), { status: 502 })
        if (!Array.isArray(schema.fields) || schema.fields.length === 0) throw Object.assign(new Error('生成的 schema 缺少 fields'), { status: 502 })
        return { schema, raw: result.text, model: result.model, usage: result.usage }
      }

      // ---------------- 气质描述 → 外观 token ----------------
      if (path === '/ai/theme' && method === 'POST') {
        const prompt = asString(body.prompt).trim()
        if (!prompt) throw badRequest('缺少 prompt：描述你想要的界面气质')
        const promptRecord = prompts.get(asString(body.promptId, 'theme.tokens'))
        if (!promptRecord) throw Object.assign(new Error('提示词 "theme.tokens" 不存在'), { status: 404 })
        const baseline = asString(body.baseline).slice(0, 2000)
        const result = await respondText(config, {
          instructions: prompts.render(promptRecord.id, { baseline: baseline || '（当前使用默认主题）' }),
          messages: [{ role: 'user', content: prompt }],
          maxOutputTokens: promptRecord.maxOutputTokens,
        })
        const tokens = extractJson(result.text) as Record<string, unknown>
        return { tokens, raw: result.text, model: result.model }
      }

      // ---------------- 通用对话 ----------------
      if (path === '/ai/chat' && method === 'POST') {
        const raw = Array.isArray(body.messages) ? body.messages : []
        const messages: AiMessage[] = raw
          .map((item) => item as { role?: unknown; content?: unknown })
          .filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
          .map((item) => ({ role: item.role as AiMessage['role'], content: String(item.content) }))
        if (messages.length === 0) throw badRequest('messages 不能为空')
        const promptId = asString(body.promptId, 'general')
        const prompt = prompts.get(promptId)
        const result = await respondText(config, {
          ...(prompt?.system ? { instructions: prompt.system } : {}),
          messages,
          maxOutputTokens: Number(query.get('max') ?? prompt?.maxOutputTokens ?? 1200) || 1200,
        })
        return { text: result.text, model: result.model, usage: result.usage }
      }

      return UNHANDLED
    },
  }
}
