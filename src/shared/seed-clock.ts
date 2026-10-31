/** 种子数据用的相对时刻：相对今天固定偏移，避免每次运行都漂移、也不写死日期。 */
export function iso(offsetDays: number, hour = 9, minute = 20): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}
