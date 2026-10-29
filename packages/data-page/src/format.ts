// 展示格式化：与 UI 库无关，放在页面层以便任何壳复用同一份格式。
//
// 时间一律走 `Intl`，避免每个页面各写一套字符串拼接。

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : dateFormatter.format(date).replaceAll('/', '-')
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
