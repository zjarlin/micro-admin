// 几何装配：从图纸的排版里推断出页面骨架。
//
// 设计师不写「这是第几列」，只把元素摆在对应区域里；编译器按几何回答三个问题：
// 1. 这个元素属于哪个区域（矩形的中心落在哪个容器里）？
// 2. 区域里的元素按什么顺序排（列按横坐标、字段按纵后横、动作按横坐标）？
// 3. 这个元素该多宽（用它的矩形宽度，对齐到 `CrudPageSchema` 的 width/minWidth）？
//
// 好处：图纸和页面是同一份几何，换画布尺寸不会改变语义；
// 反过来，从一端改动（拖宽一列）能直接反映到另一端。

import type { UiDrawing, UiElement, UiRect, UiRegion, UiRole } from './types.ts'
import { specOf } from './roles.ts'

/** 矩形中心点。 */
export function centerOf(rect: UiRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** 中心点是否落在矩形内（含边界）。 */
export function containsPoint(rect: UiRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height
}

/** 严格包含：`inner` 是否被 `outer` 覆盖（用于父子判定，排除同一矩形）。 */
export function containsRect(outer: UiRect, inner: UiRect): boolean {
  return outer !== inner
    && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

/** 面积：容器选父时用「最小包含者」。 */
export function areaOf(rect: UiRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

/** 几何阅读顺序：先上后下、先左后右。 */
export function readingOrder(left: UiElement, right: UiElement): number {
  const dy = left.rect.y - right.rect.y
  if (Math.abs(dy) > 4) return dy
  const dx = left.rect.x - right.rect.x
  if (dx !== 0) return dx
  return left.id.localeCompare(right.id)
}

/** 纯横向顺序：列、按钮同一行时按横坐标排。 */
export function horizontalOrder(left: UiElement, right: UiElement): number {
  const dx = left.rect.x - right.rect.x
  if (dx !== 0) return dx
  return left.id.localeCompare(right.id)
}

/** 判定元素是否为容器角色。 */
export function isContainer(element: UiElement): boolean {
  return specOf(element.role).layer === 'container'
}

/**
 * 找出图纸的全部区域。
 *
 * 顶层是 `page`（没有就整体兜底），其余容器按包含关系嵌套；
 * 每个容器收集「中心落在自己范围内、且不属于更深容器」的元素。
 */
export function regionsOf(drawing: UiDrawing): UiRegion[] {
  const visible = drawing.elements.filter((element) => element.visible !== false)
  const containers = visible.filter(isContainer)

  // 深层容器优先：一个元素属于「最小的包含它的容器」。
  const sorted = [...containers].sort((left, right) => areaOf(left.rect) - areaOf(right.rect))

  const regionOfElement = new Map<string, UiRegion>()
  const regions: UiRegion[] = []

  for (const container of sorted) {
    const region: UiRegion = {
      id: container.id,
      role: container.role,
      rect: container.rect,
      elementIds: [],
      childIds: [],
    }
    regions.push(region)
    regionOfElement.set(container.id, region)
  }

  for (const element of visible) {
    if (isContainer(element)) continue
    const point = centerOf(element.rect)
    const owner = sorted.find((container) => containsPoint(container.rect, point)
      && !sorted.some((other) => other !== container
        && areaOf(other.rect) < areaOf(container.rect)
        && containsPoint(other.rect, point)))
    if (!owner) continue
    const region = regionOfElement.get(owner.id)
    if (!region) continue
    region.childIds.push(element.id)
  }

  // 区域之间也记录归属，方便上层按「页面 → 表格 → 列」逐级展开。
  for (const container of sorted) {
    const region = regionOfElement.get(container.id)
    if (!region) continue
    const parent = sorted.find((other) => other !== container && containsRect(other.rect, container.rect))
    if (parent) regionOfElement.get(parent.id)?.elementIds.push(container.id)
  }

  for (const region of regions) {
    const children = region.childIds
      .map((id) => visible.find((element) => element.id === id))
      .filter((element): element is UiElement => Boolean(element))
    children.sort(region.role === 'table' ? horizontalOrder : readingOrder)
    region.childIds = children.map((element) => element.id)
  }

  return regions.sort((left, right) => areaOf(right.rect) - areaOf(left.rect))
}

/** 元素 → 所属区域（无归属时返回 `null`）。 */
export function regionOf(drawing: UiDrawing, elementId: string): UiRegion | null {
  for (const region of regionsOf(drawing)) {
    if (region.id === elementId || region.childIds.includes(elementId) || region.elementIds.includes(elementId)) {
      return region
    }
  }
  return null
}

/** 取某角色在图纸里的全部元素，按阅读顺序返回。 */
export function elementsOfRole(drawing: UiDrawing, role: UiRole): UiElement[] {
  return drawing.elements
    .filter((element) => element.role === role && element.visible !== false)
    .sort(readingOrder)
}

/**
 * 取某区域下的叶层元素，按角色分组、按几何排序。
 *
 * `regionRoles` 为空表示「只取直属子元素」；给了角色则过滤。
 */
export function leavesOf(
  drawing: UiDrawing,
  regionId: string | null,
  roles?: UiRole[],
): UiElement[] {
  const regions = regionsOf(drawing)
  const region = regionId ? regions.find((item) => item.id === regionId) : null
  const pool = region
    ? region.childIds.map((id) => findElement(drawing, id)).filter((element): element is UiElement => Boolean(element))
    : drawing.elements.filter((element) => element.visible !== false && !isContainer(element))
  const filtered = roles?.length ? pool.filter((element) => roles.includes(element.role)) : pool
  return filtered.sort((left, right) => (roles?.includes('column') ? horizontalOrder(left, right) : readingOrder(left, right)))
}

/** 按 id 取元素。 */
export function findElement(drawing: UiDrawing, id: string): UiElement | null {
  return drawing.elements.find((element) => element.id === id) ?? null
}

/**
 * 像素宽 → schema 列宽。
 *
 * 图纸上的一列常被画得比实际表格列窄、也可能很宽；这里只做两条收敛：
 * - 小于 `min` 视为「让内容撑开」，交给 `minWidth`；
 * - 大于 `max` 截断，避免把整张表顶出屏幕。
 */
export function columnWidthOf(rect: UiRect): { width?: number; minWidth: number } {
  const width = Math.round(rect.width)
  if (width < 80) return { minWidth: 80 }
  if (width > 600) return { width: 600, minWidth: 600 }
  return { width, minWidth: width }
}

/**
 * 像素宽 → 表单栅格跨度。
 *
 * 和表单容器宽度比：超过一半算整行（24），否则半行（12）。
 * 没有表单容器时按 640 像素视作「一栏」。
 */
export function spanOf(rect: UiRect, formRect: { width: number } | null): 12 | 24 {
  const reference = formRect ? formRect.width : 640
  return rect.width >= reference * 0.55 ? 24 : 12
}
