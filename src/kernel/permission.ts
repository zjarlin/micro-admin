/** 权限采用若依常见的 `system:user:list` 形式，`*:*:*` 为超级管理员。 */
export function hasPermission(granted: readonly string[], required?: string): boolean {
  if (!required) return true
  return granted.includes('*:*:*') || granted.includes(required) || granted.includes('*')
}

export function filterByPermission<T extends { permission?: string }>(
  items: readonly T[],
  granted: readonly string[],
): T[] {
  return items.filter((item) => hasPermission(granted, item.permission))
}
