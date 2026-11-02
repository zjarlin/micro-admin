// 设置值的路径读写与稳定比较。
//
// 为什么单独放这里：系统设置页是「插件声明的字段 → 通用渲染器」，
// 字段 key 支持 `panel.width` 这种点路径，取值/写值/判脏必须只有一份实现，
// 否则每个插件又会各写一套 get/set。
import type { SettingValues } from '@/kernel'

export function getPath(values: SettingValues, path: string): unknown {
  let cursor: unknown = values
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

export function setPath(values: SettingValues, path: string, value: unknown): void {
  const segments = path.split('.')
  let cursor: Record<string, unknown> = values
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      // 中间层缺失就补一个空对象：插件声明的路径即契约，缺层不该让渲染器崩掉。
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (last) cursor[last] = value
}

/** 深拷贝设置值：表单草稿与已保存副本必须完全独立。 */
export function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 稳定的结构比较：`JSON.stringify` 对键顺序敏感，草稿与后端返回的键顺序
 * 并不一致，直接比会把「没改过」判成脏。这里按键名排序后再比。
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
