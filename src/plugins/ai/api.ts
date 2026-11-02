// AI 插件的前端契约：只描述 HTTP 形状，不掺 UI。
import type { HttpClient } from '@/shared/http'
import type { ScadaDocument, ScadaSymbolDefinition, ScadaTagOption } from '@/shared/scada/types'

export interface AiConfigView {
  ready: boolean
  source: 'env' | 'codex' | 'none'
  provider: string
  model: string
  baseUrl: string
  timeoutMs: number
  prompts: number
  ops: number
}

export interface AiPromptView {
  id: string
  title: string
  scenario: string
  description: string
  system: string
  maxOutputTokens: number
  builtin: boolean
  updatedAt: number
}

export interface DslIssueView {
  line: number
  severity: 'error' | 'warn'
  message: string
  source: string
}

export interface AiDrawResult {
  promptId: string
  model: string
  elapsedMs: number
  raw: string
  commands: string
  applied: string[]
  document: ScadaDocument
  issues: DslIssueView[]
  usage: Record<string, unknown> | null
}

export interface AiChatResult {
  text: string
  model: string
  usage: Record<string, unknown> | null
}

export async function fetchAiConfig(http: HttpClient): Promise<AiConfigView> {
  return http.request<AiConfigView>('/ai/config')
}

export async function fetchPrompts(http: HttpClient): Promise<AiPromptView[]> {
  const response = await http.request<{ items: AiPromptView[] }>('/ai/prompts')
  return response.items
}

export async function savePrompt(
  http: HttpClient,
  input: { id?: string; title: string; scenario: string; description?: string; system: string; maxOutputTokens?: number },
): Promise<AiPromptView> {
  return http.request<AiPromptView>('/ai/prompts', { method: 'POST', body: JSON.stringify(input) })
}

export async function resetPrompt(http: HttpClient, id: string): Promise<AiPromptView> {
  return http.request<AiPromptView>(`/ai/prompts/${id}/reset`, { method: 'POST', body: '{}' })
}

export async function deletePrompt(http: HttpClient, id: string): Promise<void> {
  await http.request(`/ai/prompts/${id}`, { method: 'DELETE' })
}

export async function drawOnCanvas(
  http: HttpClient,
  input: {
    prompt: string
    promptId: string
    document: ScadaDocument
    symbols: ScadaSymbolDefinition[]
    tags: ScadaTagOption[]
    selection: string[]
  },
): Promise<AiDrawResult> {
  return http.request<AiDrawResult>('/ai/draw', { method: 'POST', body: JSON.stringify(input) })
}

export async function chat(
  http: HttpClient,
  input: { messages: Array<{ role: 'user' | 'assistant'; content: string }>; promptId?: string },
): Promise<AiChatResult> {
  return http.request<AiChatResult>('/ai/chat', { method: 'POST', body: JSON.stringify(input) })
}
