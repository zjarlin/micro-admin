// permission-meta 的回归测试：元树采集规则 + 运行期指令判定。
//
// 覆盖的都是「踩过坑」的点：黑名单标签显式标记、未标记组件不下钻、v-if/v-for 层级、
// 组件兜底 id、以及编译期常量 metaId 在运行期的放行/移除行为。
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import {
  buildMetaTree,
  collectComponentFiles,
  mergeRoots,
  readIdLiteral,
  readLiteral,
  readObjectLiteral,
} from '@addzero/permission-meta/meta'
import { createPermissionMetaDirective, decide } from '@addzero/permission-meta/runtime'
import type { ObjectDirective } from 'vue'
import type { DirectiveValue } from '@addzero/permission-meta/runtime'
import type { AstNode, MetaNode } from '@addzero/permission-meta/meta'

/** 把一段模板包成 SFC 并取模板 AST（与插件在构建期拿到的是同一种结构）。 */
function astOf(template: string): AstNode {
  const { descriptor } = parse(`<template>${template}</template>`, { filename: 'src/X.vue' })
  return descriptor.template?.ast as AstNode
}

function build(template: string, components: Record<string, string> = {}) {
  return buildMetaTree(astOf(template), {
    sourceFile: 'src/X.vue',
    resolveComponentFile: (tag) => components[tag] ?? null,
  })
}

const ids = (tree: ReturnType<typeof build>) => tree.ordered.map((plan) => plan.metaId)
const shape = (nodes: ReturnType<typeof build>['roots']): string[] =>
  nodes.map((node) => `${node.tag}(${node.children.map((child) => child.tag).join(',')})`)

describe('permission-meta / 字面量解析', () => {
  it('只接受静态字面量', () => {
    expect(readLiteral("'查询区域'")).toBe('查询区域')
    expect(readLiteral('"a:b c"')).toBe('a:b c')
    expect(readLiteral("'a\\nb'")).toBe('a\nb')
    expect(readLiteral('42')).toBe('42')
    expect(readLiteral('SOME_CONST')).toBeUndefined()
    expect(readLiteral('`x${y}`')).toBeUndefined()
  })

  it('id 接受裸标识符与带引号字符串，拒绝表达式', () => {
    expect(readIdLiteral('user_query_area')).toBe('user_query_area')
    expect(readIdLiteral("'page:a/b.vue:3'")).toBe('page:a/b.vue:3')
    expect(readIdLiteral('a + b')).toBeUndefined()
  })

  it('对象字面量拒绝非字面量值，正确处理字符串里的逗号', () => {
    expect(readObjectLiteral("{ name: '查询区域', group: 'query' }")).toEqual({ name: '查询区域', group: 'query' })
    expect(readObjectLiteral('{ name: foo }')).toBeUndefined()
    expect(readObjectLiteral("{ extra: { a: 1 } }")).toBeUndefined()
    expect(readObjectLiteral("{ desc: 'a,b', group: 'g' }")).toEqual({ desc: 'a,b', group: 'g' })
  })
})

describe('permission-meta / 采集规则', () => {
  it('只有写了 v-meta 的节点才进树', () => {
    expect(ids(build('<div><span v-meta /></div>'))).toEqual(['page:src/X.vue:0'])
  })

  it('页面就地区块与业务组件两种场景都按「最近的标记后代」成树', () => {
    const tree = build(
      `<div v-meta="{ name: '顶层' }"><section><span v-meta="{ name: '子' }" /></section><BizAddBtn v-meta /></div>`,
      { BizAddBtn: 'src/components/BizAddBtn.vue' },
    )
    expect(ids(tree)).toEqual(['page:src/X.vue:0', 'page:src/X.vue:1', 'biz:src/components/BizAddBtn.vue'])
    expect(shape(tree.roots)).toEqual(['div(span,BizAddBtn)'])
  })

  it('未标记的组件是黑盒：整棵子树都不采集', () => {
    const tree = build('<div v-meta><el-form><el-row><span v-meta /></el-row></el-form></div>')
    expect(ids(tree)).toEqual(['page:src/X.vue:0'])
    expect(shape(tree.roots)).toEqual(['div()'])
  })

  it('组件内部结构永远不展开（黑盒叶节点）', () => {
    const tree = build('<BizAddBtn v-meta />', { BizAddBtn: 'src/components/BizAddBtn.vue' })
    expect(tree.roots[0]?.children).toEqual([])
  })

  it('v-if / v-else / v-for 正常处理，层级不错位', () => {
    const tree = build(
      `<div v-meta="{ name: '区' }"><template v-if="ok"><span v-meta /></template><li v-for="r in rs" v-meta /></div>`,
    )
    expect(ids(tree)).toEqual(['page:src/X.vue:0', 'page:src/X.vue:1', 'page:src/X.vue:2'])
    expect(shape(tree.roots)).toEqual(['div(span,li)'])
    expect(shape(build('<div v-if="a" v-meta /><div v-else v-meta />').roots)).toEqual(['div()', 'div()'])
  })

  it('显式 id 优先；同一业务组件全站共用一个 biz id', () => {
    expect(build('<div v-meta:id="fixed_one" /><div v-meta:id="fixed_one" />').roots.map((n) => n.metaId)).toEqual([
      'fixed_one',
      'fixed_one',
    ])
    const tree = build('<div v-meta><BizAddBtn v-meta /><BizAddBtn v-meta /></div>', {
      BizAddBtn: 'src/components/BizAddBtn.vue',
    })
    expect(tree.roots[0]?.children.map((n) => n.metaId)).toEqual([
      'biz:src/components/BizAddBtn.vue',
      'biz:src/components/BizAddBtn.vue',
    ])
  })

  it('解析不到本地来源的组件退回页面就地区块 id', () => {
    expect(build('<el-tag v-meta />').roots.map((n) => n.metaId)).toEqual(['page:src/X.vue:0'])
  })

  it('元节点字段与顺序固定', () => {
    const node = build(`<div v-meta="{ name: 'n', desc: 'd', group: 'g' }" />`).roots[0]
    expect(node).toEqual({
      metaId: 'page:src/X.vue:0',
      name: 'n',
      desc: 'd',
      group: 'g',
      sourceFile: 'src/X.vue',
      tag: 'div',
      children: [],
    })
  })

  it('非法写法会告警但不阻断', () => {
    expect(build('<div v-meta="someVar" />').issues.some((i) => i.includes('无法静态解析'))).toBe(true)
    expect(build('<div v-meta:foo="1" />').issues.some((i) => i.includes('不支持参数'))).toBe(true)
  })

  it('两次采集结果完全一致（确定性）', () => {
    expect(ids(build('<div v-meta><span v-meta /></div>'))).toEqual(ids(build('<div v-meta><span v-meta /></div>')))
  })
})

describe('permission-meta / 黑盒组件不外泄', () => {
  const components = { BizAddBtn: 'src/components/BizAddBtn.vue', BizFilter: 'src/components/BizFilter.vue' }

  /** 合并测试只关心 metaId，用最小节点形状即可。 */
  function node(metaId: string): MetaNode {
    return { metaId, name: '', desc: '', group: '', sourceFile: '', tag: '', children: [] }
  }

  it('记录本模板用到的本地 .vue，含未标 v-meta 的组件标签', () => {
    // unwrapped 用 BizFilter（未标 v-meta）也要被认出来，否则 BizFilter.vue 的内部标记会外泄。
    const files = collectComponentFiles(
      astOf('<div><BizAddBtn v-meta /><BizFilter /><el-input /><component :is="x" /></div>'),
      (tag) => components[tag as keyof typeof components] ?? null,
    )
    expect(files).toEqual(['src/components/BizAddBtn.vue', 'src/components/BizFilter.vue'])
  })

  it('被当组件用的文件，其内部标记整棵剔除，页面标记保留', () => {
    const merged = mergeRoots([
      // 页面：引用 BizAddBtn（黑盒），自身有可配置区块
      { sourceFile: 'src/App.vue', roots: [node('page:src/App.vue:0')], componentFiles: ['src/components/BizAddBtn.vue'] },
      // 组件文件：内部也标了 v-meta，但不该冒充页面级区块
      { sourceFile: 'src/components/BizAddBtn.vue', roots: [node('page:src/components/BizAddBtn.vue:0')], componentFiles: [] },
    ])
    expect(merged.roots.map((n) => n.metaId)).toEqual(['page:src/App.vue:0'])
    expect(merged.skipped).toEqual(['src/components/BizAddBtn.vue'])
  })

  it('没人当组件用的文件照常出根（页面、布局都在此列）', () => {
    const merged = mergeRoots([
      { sourceFile: 'src/pages/Order.vue', roots: [node('page:src/pages/Order.vue:0')], componentFiles: [] },
      { sourceFile: 'src/layouts/AdminLayout.vue', roots: [node('page:src/layouts/AdminLayout.vue:0')], componentFiles: [] },
    ])
    expect(merged.roots.map((n) => n.metaId)).toEqual([
      'page:src/layouts/AdminLayout.vue:0',
      'page:src/pages/Order.vue:0',
    ])
    expect(merged.skipped).toEqual([])
  })

  it('根按 sourceFile 排序，平铺且确定', () => {
    const once = mergeRoots([
      { sourceFile: 'src/b.vue', roots: [node('b')], componentFiles: [] },
      { sourceFile: 'src/a.vue', roots: [node('a')], componentFiles: [] },
    ])
    expect(once.roots.map((n) => n.metaId)).toEqual(['a', 'b'])
  })

  it('buildMetaTree 顺带产出 componentFiles（未标记组件也算）', () => {
    const tree = build('<div v-meta><BizAddBtn v-meta /><BizFilter /></div>', components)
    expect(tree.componentFiles).toEqual(['src/components/BizAddBtn.vue', 'src/components/BizFilter.vue'])
  })
})

describe('permission-meta / 运行期指令', () => {
  /** 以最小可用的绑定信息触发 mounted（vnode 参数与判定无关，运行期指令不读它）。 */
  function mount(directive: ObjectDirective<HTMLElement, DirectiveValue>, el: HTMLElement, arg: string): void {
    directive.mounted?.(el, { arg, value: undefined, modifiers: {}, instance: null, dir: directive } as never, null as never, null as never)
  }

  it('按编译期写死的 metaId 放行或移除', () => {
    const allowed = decide('monitor:server:view', undefined, { granted: ['monitor:server:view'] })
    expect(allowed.allowed).toBe(true)
    const denied = decide('monitor:server:view', undefined, { granted: ['system:user:list'] })
    expect(denied.allowed).toBe(false)
  })

  it('超管与通配放行；未配 resolve 时不误放行', () => {
    expect(decide('x', undefined, { granted: ['*:*:*'] }).allowed).toBe(true)
    expect(decide('x', undefined, { granted: ['*'] }).allowed).toBe(true)
    expect(decide('biz:a.vue', undefined, { granted: ['system:user:add'], resolve: () => 'system:user:add' }).allowed).toBe(true)
    expect(decide('biz:a.vue', undefined, { granted: ['system:user:add'] }).allowed).toBe(false)
  })

  it('指令在未授权时把节点替换成注释（等价 v-if=false）', () => {
    const directive = createPermissionMetaDirective({ granted: [] })
    const parent = document.createElement('div')
    const el = document.createElement('span')
    parent.appendChild(el)
    mount(directive, el, 'secret_area')
    expect(parent.querySelector('span')).toBeNull()
    expect(parent.innerHTML).toContain('<!--permission-meta-->')
  })

  it('onDenied=hide 时只隐藏不移除', () => {
    const directive = createPermissionMetaDirective({ granted: [], onDenied: 'hide' })
    const el = document.createElement('span')
    document.body.appendChild(el)
    mount(directive, el, 'secret_area')
    expect(el.style.display).toBe('none')
    el.remove()
  })
})
