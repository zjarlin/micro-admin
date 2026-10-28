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

export function initialsOf(name: string): string {
  return [...name.trim()].slice(0, 2).join('').toUpperCase() || 'U'
}
