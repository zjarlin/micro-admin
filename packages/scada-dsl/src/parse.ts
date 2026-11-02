// 指令解析：逐行切成 `op args... k=v ...`。
//
// 解析器只做词法/形状判断（未知指令、缺参数），真正的语义校验在执行器里，
// 这样提示词、帮助面板、执行器可以共用同一份「指令名 + 参数形状」。
import { DSL_OP_NAMES, DSL_OPS } from './grammar.ts'
import type { DslCommand, DslIssue, DslParseResult } from './types.ts'

/** 按空白切词，支持用双引号包住含空格的文本。 */
function tokenize(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/** 去掉 `#` 注释（引号内的不算）。 */
function stripComment(line: string): string {
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '#') return line.slice(0, i)
  }
  return line
}

/** 把 `k=v` 形式的词收进 options；其余留给 args。 */
function splitOptions(tokens: string[]): { args: string[]; options: Record<string, string> } {
  const args: string[] = []
  const options: Record<string, string> = {}
  for (const token of tokens) {
    const index = token.indexOf('=')
    if (index > 0) options[token.slice(0, index)] = token.slice(index + 1)
    else args.push(token)
  }
  return { args, options }
}

/**
 * `bind press.needle=102` 这种「目标里带等号」的写法单独处理：
 * 否则会被当成 `key=value` 丢掉目标。
 */
function splitBind(tokens: string[]): { args: string[]; options: Record<string, string> } {
  const [head, ...rest] = tokens
  if (!head) return { args: [], options: {} }
  const options: Record<string, string> = {}
  for (const token of rest) {
    const index = token.indexOf('=')
    if (index > 0) options[token.slice(0, index)] = token.slice(index + 1)
  }
  let target = head
  // 目标里的等号与后面的 key=value 选项可以共存：
  // `bind press.value=102 precision=2 unit=MPa` 也要能取到 value。
  if (target.includes('=')) {
    const index = target.lastIndexOf('=')
    options.value = target.slice(index + 1)
    target = target.slice(0, index)
  }
  if (!options.value && options.tag) options.value = options.tag
  return { args: [target], options }
}

export function parseCommands(source: string): DslParseResult {
  const commands: DslCommand[] = []
  const issues: DslIssue[] = []

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw).trim()
    if (!line) return
    const lineNo = index + 1
    const tokens = tokenize(line)
    const op = tokens[0] ?? ''
    if (!DSL_OP_NAMES.has(op)) {
      issues.push({
        line: lineNo,
        severity: 'error',
        message: `未知指令 "${op}"，可用指令：${[...DSL_OP_NAMES].join(' / ')}`,
        source: line,
      })
      return
    }
    const rest = tokens.slice(1)
    const split = op === 'bind' ? splitBind(rest) : splitOptions(rest)
    if (op !== 'grid' && op !== 'canvas' && split.args.length === 0) {
      const spec = DSL_OPS.find((item) => item.name === op)
      issues.push({
        line: lineNo,
        severity: 'error',
        message: `指令 "${op}" 缺少目标：${spec?.usage ?? ''}`,
        source: line,
      })
      return
    }
    commands.push({ line: lineNo, source: line, op, args: split.args, options: split.options })
  })

  return { commands, issues }
}

/** 只取文本里第一个 ```scada / ```dsl / ``` 代码块（模型常带解释文字）。 */
export function extractCodeBlock(text: string): string {
  const fenced = text.match(/```(?:scada|dsl|txt|text)?\s*\n([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  // 模型输出被 token 上限截断时没有收尾围栏：只去掉开头的 ```lang 行，剩下的仍是有效指令。
  return text
    .split(/\r?\n/)
    .filter((line, index, all) => !(index === 0 && /^\s*```/.test(line)) && !(index === all.length - 1 && /^\s*```\s*$/.test(line)))
    .join('\n')
    .trim()
}
