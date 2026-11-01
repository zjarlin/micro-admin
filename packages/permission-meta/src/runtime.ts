// 运行期配套：v-permission-meta 指令。
//
// 与编译期的分工：
// - 编译期已经把该节点对应的 metaId **静态写进指令参数**（`binding.arg`），运行期不需要
//   读任何 DOM 属性、也不需要 meta-tree.json；产物里就是 `[directive, ids, "page:…:3"]`。
// - 运行期只做一件事：拿 metaId 去授权集合里查，没授权就把节点从 DOM 移除。
//
// 「移除」等价于 v-if=false：指令的最小作用单位是一个元素/组件根，Vue 不允许指令写 v-if，
// 所以在 mounted 时把节点替换成注释节点，渲染结果与条件为假一致（父容器该层仍占位，
// 与 v-if 的行为相同）；布局敏感的地方请用 v-permission-meta 包一层真实元素。
import type { App, DirectiveBinding, ObjectDirective } from 'vue'

/** 授权来源：静态 id 集合，或一个动态查询函数。 */
export type GrantedSource = readonly string[] | (() => readonly string[])

export interface PermissionMetaRuntimeOptions {
  /** 当前用户的权限 id 列表来源（全局默认值）。 */
  granted?: GrantedSource
  /**
   * metaId → 实际要校验的权限 id（可多个）。
   *
   * 默认不配：直接用 metaId 去 `granted` 里查——这正是「后台按 metaId 配置可见性」的用法。
   * 当项目的权限码与 metaId 分属不同命名空间时（例如 metaId 是 `biz:src/x/AddBtn.vue`、
   * 权限码是 `system:user:add`），在这里把 metaId 映射成权限码，避免两套 id 混着用。
   */
  resolve?: (metaId: string) => string | readonly string[] | undefined
  /** 超级权限；命中即全部放行。默认 `*:*:*`。 */
  superPermission?: string
  /** 是否同时接受通配 `*`；默认 true（与既有 `hasPermission` 行为一致）。 */
  wildcard?: boolean
  /** 未授权时的处理方式；默认把节点替换成注释（等价 v-if=false）。 */
  onDenied?: 'remove' | 'hide'
}

/** 归一化授权来源为数组。 */
function readGranted(source: GrantedSource | undefined): readonly string[] {
  if (source === undefined) return []
  return typeof source === 'function' ? source() : source
}

/** 指令运行时读到的值：既支持 `v-permission-meta="ids"`，也支持 `v-permission-meta="() => ids"`。 */
export type DirectiveValue = readonly string[] | (() => readonly string[]) | undefined

export interface PermissionDecision {
  metaId: string
  granted: readonly string[]
  /** 实际用于判定的权限 id（配了 resolve 时是映射结果；否则就是 metaId）。 */
  required?: readonly string[]
  allowed: boolean
}

/** 判定入口：集中一处，方便宿主复用（菜单/按钮/自检都调它，避免第二套规则）。 */
export function decide(
  metaId: string | undefined,
  value: DirectiveValue,
  options: PermissionMetaRuntimeOptions,
): PermissionDecision {
  const granted = readGranted(
    typeof value === 'function' || Array.isArray(value) ? (value as GrantedSource) : options.granted,
  )
  if (metaId === undefined || metaId === '') return { metaId: metaId ?? '', granted, allowed: true }

  const superPermission = options.superPermission ?? '*:*:*'
  if (granted.includes(superPermission)) return { metaId, granted, allowed: true }
  if (options.wildcard !== false && granted.includes('*')) return { metaId, granted, allowed: true }

  // metaId 默认直接就是权限 id；配了 resolve 就用它映射到本项目的权限码命名空间。
  // resolve 返回 undefined 视为「不做映射」，直接按 metaId 校验。
  const mapped = options.resolve?.(metaId)
  const required = mapped === undefined ? metaId : mapped
  const requiredList = typeof required === 'string' ? [required] : required
  const allowed = requiredList.some((id) => granted.includes(id))
  return { metaId, granted, required: requiredList, allowed }
}

/** 未授权时的处理：移除或隐藏。 */
function deny(el: HTMLElement, mode: 'remove' | 'hide'): void {
  if (mode === 'hide') {
    el.style.display = 'none'
    el.setAttribute('data-permission-meta', 'denied')
    return
  }
  const parent = el.parentNode
  if (parent === null) {
    el.style.display = 'none'
    return
  }
  // 换成注释节点：既不占视觉、也不参与可访问性树，与 v-if=false 的产出形态一致。
  const comment = el.ownerDocument.createComment('permission-meta')
  parent.replaceChild(comment, el)
}

/**
 * 创建 v-permission-meta 指令。
 *
 * 指令参数（`binding.arg`）由编译期静态写入 metaId；指令值（`binding.value`）是授权列表，
 * 不传时回落到 `options.granted`。
 */
export function createPermissionMetaDirective(
  options: PermissionMetaRuntimeOptions = {},
): ObjectDirective<HTMLElement, DirectiveValue> {
  const mode = options.onDenied ?? 'remove'
  return {
    mounted(el, binding: DirectiveBinding<DirectiveValue>) {
      const decision = decide(binding.arg, binding.value, options)
      if (!decision.allowed) deny(el, mode)
    },
  }
}

/** 安装入口：注册全局指令 `v-permission-meta`。 */
export function installPermissionMeta(app: App, options: PermissionMetaRuntimeOptions = {}): void {
  app.directive('permission-meta', createPermissionMetaDirective(options))
}

/**
 * 读取某个元素当前生效的 metaId（仅供调试/自检；业务逻辑不要依赖它）。
 *
 * 说明：metaId 在编译期进了指令参数，运行期不会落到 DOM 属性上，所以这里读的是
 * 指令绑定信息是否可用——Vue 不暴露该信息时返回 undefined。正常判定请直接用 `decide`。
 */
export function peekMetaId(): string | undefined {
  return undefined
}
