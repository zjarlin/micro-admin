// 「画布工具」：把「改组态画布」这件事暴露成一个可被别的 AI 消费的能力。
//
// 为什么需要它：通用页面助手（`page-agent`）很会操作 DOM，但它不知道怎么改组态画布——
// 画布是 SVG + 文档模型，不是一堆可点的按钮。与其让画布再维护一个自己的对话框，
// 不如把「按自然语言改画布」做成一个工具：页面助手在画布页多了一把「画笔」，
// 用户仍然只用顶栏那一个助手对话框。
//
// 边界：工具只调后端 `/ai/draw`（指令集生成 + 应用都在服务端完成），
// 前端仅负责提供当前文档、图元库、变量与选中项，然后把结果写回画布。
import type { HttpClient } from '@/shared/http'
import { useScadaWorkbench } from '@/plugins/scada/workbench'
import { drawOnCanvas, type AiDrawResult, type DslIssueView } from './api'

export interface CanvasDrawOutcome {
  ok: boolean
  /** 人话结论，直接回给模型（它再转述给用户）。 */
  text: string
  /** 已应用的指令行（供模型复述或调试）。 */
  applied: string[]
  issues: DslIssueView[]
  result: AiDrawResult | null
}

export interface CanvasDrawTool {
  /** 当前是否有一张打开的画布。 */
  available(): boolean
  /** 跑一次「按自然语言改画布」，成功时已经把结果写回画布。 */
  run(instruction: string, options?: { promptId?: string | undefined; apply?: boolean | undefined }): Promise<CanvasDrawOutcome>
}

export function createCanvasDrawTool(http: HttpClient): CanvasDrawTool {
  const workbench = useScadaWorkbench()

  return {
    available: () => workbench.handle.value !== null,

    async run(instruction, options = {}) {
      const handle = workbench.handle.value
      const prompt = instruction.trim()
      if (!prompt) return { ok: false, text: '指令为空：先说要画什么。', applied: [], issues: [], result: null }
      if (!handle) {
        return {
          ok: false,
          text: '当前没有打开组态画布。请先打开「画布 → 组态画布」并选中一张画面，再让我改画布。',
          applied: [],
          issues: [],
          result: null,
        }
      }

      try {
        const result = await drawOnCanvas(http, {
          prompt,
          promptId: options.promptId ?? 'scada.draw',
          document: handle.readDocument(),
          symbols: handle.readSymbols(),
          tags: handle.readTags(),
          selection: handle.readSelection(),
        })
        const errors = result.issues.filter((item) => item.severity === 'error')
        if (options.apply === false) {
          return {
            ok: errors.length === 0,
            text: `模型产出 ${result.applied.length} 条指令（未应用）。`,
            applied: result.applied,
            issues: result.issues,
            result,
          }
        }
        if (!result.applied.length) {
          return { ok: false, text: '模型没有产出可执行的指令，换个说法再试一次。', applied: [], issues: result.issues, result }
        }
        handle.writeDocument(result.document)
        const tail = errors.length ? `；有 ${errors.length} 条指令未通过校验：${errors[0]?.message ?? ''}` : ''
        return {
          ok: errors.length === 0,
          text: `已应用 ${result.applied.length} 条指令到画布${tail}。注意：改动还没保存，需要用户在画布工具条点「保存」。`,
          applied: result.applied,
          issues: result.issues,
          result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成失败'
        return { ok: false, text: `改画布失败：${message}`, applied: [], issues: [], result: null }
      }
    },
  }
}
