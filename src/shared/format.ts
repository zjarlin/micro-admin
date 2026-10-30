// 宿主展示格式化：通用部分直接复用页面层，避免出现第二套实现。
//
// `formatDateTime` / `formatPercent` 由 `@zjarlin/data-page` 提供（单元格渲染与此同源）；
// 这里只保留后台壳自己的头像缩写等本地约定。
export { formatDateTime, formatPercent } from '@zjarlin/data-page'

export function initialsOf(name: string): string {
  return [...name.trim()].slice(0, 2).join('').toUpperCase() || 'U'
}
