// 指令集的唯一真相：绘图指令 + 排版指令 + 画布指令。
//
// 提示词、帮助面板、解析器都从这里取指令清单——新增一条指令只改这一处，
// 不会出现「文档里有、模型不会用」或「模型用了、解析器不认」的两套。
import type { DslOpSpec } from './types.ts'

export const DSL_OPS: DslOpSpec[] = [
  // ---------------- 绘制 ----------------
  {
    name: 'add', group: 'draw',
    usage: 'add <symbolKey> [as <id>] [name=<文本>] [at <x>,<y>] [size <w>x<h>] [props k=v ...]',
    summary: '新增一个图元。不给坐标时自动错位摆放；`as` 指定 id 供后续指令引用，否则自动生成。',
    example: 'add gauge as press name=出水压力 at 420,180 size 180x180',
  },
  {
    name: 'remove', group: 'draw',
    usage: 'remove <ref>...',
    summary: '删除图元（ref 可以是 id、@last、@selection）。',
    example: 'remove @selection',
  },
  {
    name: 'move', group: 'draw',
    usage: 'move <ref>... to <x>,<y> | move <ref>... by <dx>,<dy>',
    summary: '移动图元到绝对坐标，或按增量平移。',
    example: 'move press by 0,40',
  },
  {
    name: 'resize', group: 'draw',
    usage: 'resize <ref>... to <w>x<h>',
    summary: '改尺寸；图元声明 keepAspect 时按宽度等比算高度。',
    example: 'resize tank to 120x220',
  },
  {
    name: 'rotate', group: 'draw',
    usage: 'rotate <ref>... to <0|90|180|270>',
    summary: '旋转，只允许 90 度整数倍。',
    example: 'rotate valve to 90',
  },
  {
    name: 'zorder', group: 'draw',
    usage: 'zorder <ref>... front|back|up|down',
    summary: '层叠顺序。',
    example: 'zorder pipe1 back',
  },
  {
    name: 'lock', group: 'draw',
    usage: 'lock <ref>... on|off',
    summary: '锁定/解锁图元（锁定的图元不会被 AI 的布局指令移动）。',
    example: 'lock title on',
  },
  {
    name: 'show', group: 'draw',
    usage: 'show <ref>... | hide <ref>...',
    summary: '显示/隐藏图元。',
    example: 'hide legend',
  },
  {
    name: 'style', group: 'draw',
    usage: 'style <ref>... <propKey>=<value> ...',
    summary: '改图元属性（文字内容、字号、颜色等，键名来自图元定义的 props）。',
    example: 'style title fontSize=22 color=#e2e8f0',
  },
  {
    name: 'bind', group: 'draw',
    usage: 'bind <ref>.<slot>=<tagId|变量名> [precision=<n>] [unit=<单位>]',
    summary: '把通道变量绑到图元槽位；变量名按名称模糊匹配。',
    example: 'bind press.needle=102',
  },
  {
    name: 'unbind', group: 'draw',
    usage: 'unbind <ref>[.<slot>]',
    summary: '解绑单个槽位或整块图元。',
    example: 'unbind press.needle',
  },
  // ---------------- 画布 ----------------
  {
    name: 'canvas', group: 'canvas',
    usage: 'canvas [size <w>x<h>] [grid=<n>] [background=<颜色>] [gridlines=on|off]',
    summary: '改画布尺寸、栅格间距、背景色与栅格显示。',
    example: 'canvas size 1600x900 grid=20 background=#0b1220',
  },
  // ---------------- 排版 ----------------
  {
    name: 'align', group: 'layout',
    usage: 'align <left|right|top|bottom|hcenter|vcenter> <ref>...',
    summary: '对齐：以引用集合的包围盒为基准（单引用时以画布为基准）。',
    example: 'align left title press tank',
  },
  {
    name: 'distribute', group: 'layout',
    usage: 'distribute <h|v> <ref>... [gap=<n>]',
    summary: '等间距分布；给 gap 时按固定间距排布。',
    example: 'distribute h pump1 pump2 pump3 gap=24',
  },
  {
    name: 'grid', group: 'layout',
    usage: 'grid cols=<n> [rows=<n>] [gap=<n>] [at <x>,<y>] [size <w>x<h>] <ref>...',
    summary: '网格排布：按列数/行数铺开，单元尺寸缺省按画布与间距推算。',
    example: 'grid cols=3 gap=24 at 80,160 size 320x220 title a b c',
  },
  {
    name: 'stack', group: 'layout',
    usage: 'stack <h|v> <ref>... [gap=<n>]',
    summary: '紧凑堆叠（保留各自尺寸，只改位置）。',
    example: 'stack v legend note gap=12',
  },
  {
    name: 'center', group: 'layout',
    usage: 'center <ref>...',
    summary: '把选中集合整体居中到画布。',
    example: 'center @selection',
  },
  {
    name: 'fit', group: 'layout',
    usage: 'fit <ref>... [padding=<n>]',
    summary: '等比缩放并平移，让集合完整落在画布内。',
    example: 'fit @selection padding=48',
  },
  {
    name: 'anchor', group: 'layout',
    usage: 'anchor <ref>... <tl|tr|bl|br|tc|bc|lc|rc> [margin=<n>]',
    summary: '把图元锚定到画布的四角/四边中点。',
    example: 'anchor legend tr margin=32',
  },
]

/** 按组取指令（帮助面板/提示词分段用）。 */
export function opsOfGroup(group: DslOpSpec['group']): DslOpSpec[] {
  return DSL_OPS.filter((op) => op.group === group)
}

/** 指令名的集合，解析器据此判断「这条是不是已知指令」。 */
export const DSL_OP_NAMES = new Set(DSL_OPS.map((op) => op.name))

/**
 * 渲染成给模型看的能力清单（提示词的一部分）。
 *
 * 只列语法与语义，不列实现细节：模型只需要知道能做什么、怎么写，
 * 校验与几何计算都在执行器里完成，模型算错也会被纠正或被拒绝。
 */
export function opsCatalogMarkdown(): string {
  const section = (title: string, group: DslOpSpec['group']): string => {
    const rows = opsOfGroup(group).map((op) => `- \`${op.usage}\`：${op.summary}\n  例：\`${op.example}\``)
    return `### ${title}\n${rows.join('\n')}`
  }
  return [
    section('绘制指令', 'draw'),
    section('排版指令', 'layout'),
    section('画布指令', 'canvas'),
  ].join('\n\n')
}

/** 引用写法说明（ref 在每条指令里含义相同，单独说明避免重复）。 */
export const REF_HELP = [
  '`<ref>` 可以是：`as` 指定的 id、`@last`（最近新增的图元）、`@selection`（当前选中）。',
  '多条用空格分隔；指令按行自上而下执行，后面的指令能引用前面的结果。',
].join('\n')
