// vibeelement 的运行时契约辅助：通道 → 模板变量名的唯一推导处。
//
// 图纸包（`ui-canvas`）用它生成默认模板里的方法名，UI 适配层（`data-page-element`）
// 用它把绑定装进模板作用域。两边必须一致，所以推导只写在这里，不要各写一份。

import type { Row, VibeBindingSchema, VibeSchema } from './schema.ts'

/** 事件通道 → 模板里的方法名：`click` → `onClick`、`change` → `onChange`。 */
export function vibeHandlerName(channel: string): string {
  const head = channel[0]?.toUpperCase() ?? ''
  return `on${head}${channel.slice(1)}`
}

/** 模板声明的事件通道（去重，保持声明顺序）。 */
export function vibeEventChannels(vibe: VibeSchema | undefined): string[] {
  const channels: string[] = []
  for (const binding of vibe?.bindings ?? []) {
    if (binding.kind !== 'event') continue
    if (!channels.includes(binding.channel)) channels.push(binding.channel)
  }
  return channels
}

/** 数据通道的取值键：声明了 `source` 就用它，否则就是通道名本身。 */
export function vibeSourceKey(binding: VibeBindingSchema): string {
  return binding.source ?? binding.channel
}

/**
 * 把宿主算好的槽位取值投影成模板作用域。
 *
 * `values` 里是**不带点**的别名（`value` / `row` / `label` / `rows`），模板直接用；
 * 声明了数据绑定则再按通道名补一份（`column.value`），供需要精确通道的模板使用。
 * 因此「只写一段模板、不配绑定」也能立刻看到效果，配了绑定则更精确。
 */
export function vibeScopeData(vibe: VibeSchema | undefined, values: Row): Row {
  const data: Row = { ...values }
  for (const binding of vibe?.bindings ?? []) {
    if (binding.kind !== 'data') continue
    const key = vibeSourceKey(binding)
    if (key in values) data[binding.channel] = values[key]
  }
  return data
}
