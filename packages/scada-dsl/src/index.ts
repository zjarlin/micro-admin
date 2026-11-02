// 组态 AI 指令集门面。
//
// 一组能力拆成三层，任何一层都能单独用：
// - `grammar`：指令清单（提示词/帮助面板的真相来源）；
// - `parse`：文本 → 指令（带行号的错误）；
// - `apply`：指令 → 新文档（几何、锁定、变量绑定都在这里）；
// - `describe`：文档 → 给模型看的紧凑上下文与布局体检。
export { DSL_OPS, DSL_OP_NAMES, REF_HELP, opsCatalogMarkdown, opsOfGroup } from './grammar.ts'
export { extractCodeBlock, parseCommands } from './parse.ts'
export { applyCommands } from './apply.ts'
export { describeDocument, layoutStats } from './describe.ts'
export type { DescribeOptions } from './describe.ts'
export type {
  DslApplyOptions,
  DslApplyResult,
  DslBinding,
  DslCanvas,
  DslCommand,
  DslDocument,
  DslIssue,
  DslOpSpec,
  DslParseResult,
  DslRect,
  DslSeverity,
  DslSymbol,
  DslTag,
  DslWidget,
} from './types.ts'
