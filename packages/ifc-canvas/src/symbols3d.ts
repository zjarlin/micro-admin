// 绘图指令集 → 3D 规格的规则表（L0：零 token 也能出模型）。
//
// 15 个内置图元逐条给出「厚度策略 / 离地高度 / 材质 / 几何形式」，
// 并对回转体（泵、电机、储罐、阀门、管道）按部件覆盖。规则命中就不问模型；
// 只有规则表覆盖不到的自定义图元才进 `plan.ts` 的缺失清单追问 AI。
//
// 单位一律毫米：默认 1px = 1mm，和 IFC 的 LENGTHUNIT 一致。

import type { DepthRule, ExtrusionForm, ExtrusionMaterial, Part3DSpec, PartRole, SymbolLike } from './types.ts'

export interface Part3DRule {
  role: PartRole
  form: ExtrusionForm
  depthRule: DepthRule
  elevation: number
  material: ExtrusionMaterial
  textMode: 'decal' | 'skip'
}

export interface Symbol3DRule extends Part3DRule {
  /** 按部件 id 覆盖（同一图元里壳体是圆柱、叶轮只是贴面）。 */
  parts?: Record<string, Partial<Part3DRule>> | undefined
}

const ratio = (value: number): DepthRule => ({ mode: 'ratio', ratio: value })
const mm = (value: number): DepthRule => ({ mode: 'absolute', mm: value })

/** 内置图元规则：key 与 `builtin-symbols.json` 完全一致。 */
export const SYMBOL_3D_RULES: Record<string, Symbol3DRule> = {
  'basic.rect': {
    role: 'structure',
    form: 'extrude',
    depthRule: ratio(0.06),
    elevation: 0,
    material: 'paint',
    textMode: 'skip',
  },
  'basic.text': {
    role: 'label',
    form: 'decal',
    depthRule: mm(0),
    elevation: 1500,
    material: 'none',
    textMode: 'decal',
  },
  'display.value': {
    role: 'instrument',
    form: 'extrude',
    depthRule: mm(60),
    elevation: 1300,
    material: 'plastic',
    textMode: 'decal',
    parts: {
      value: { form: 'decal' },
      caption: { form: 'decal', role: 'label' },
    },
  },
  'display.gauge': {
    role: 'instrument',
    form: 'extrude',
    depthRule: mm(70),
    elevation: 1300,
    material: 'plastic',
    textMode: 'decal',
    parts: {
      needle: { form: 'decal' },
      caption: { form: 'decal', role: 'label' },
    },
  },
  'display.bar': {
    role: 'instrument',
    form: 'extrude',
    depthRule: mm(80),
    elevation: 1200,
    material: 'plastic',
    textMode: 'decal',
    parts: {
      level: { form: 'decal', material: 'liquid' },
      caption: { form: 'decal', role: 'label' },
    },
  },
  'display.alarm': {
    role: 'instrument',
    form: 'extrude',
    depthRule: mm(40),
    elevation: 2200,
    material: 'plastic',
    textMode: 'decal',
    parts: {
      text: { form: 'decal', role: 'label' },
    },
  },
  'control.indicator': {
    role: 'instrument',
    form: 'cylinder',
    depthRule: mm(40),
    elevation: 1350,
    material: 'glass',
    textMode: 'decal',
    parts: {
      lamp: { form: 'cylinder' },
      caption: { form: 'decal', role: 'label' },
    },
  },
  'control.button': {
    role: 'instrument',
    form: 'extrude',
    depthRule: mm(35),
    elevation: 1100,
    material: 'plastic',
    textMode: 'decal',
    parts: {
      caption: { form: 'decal', role: 'label' },
    },
  },
  'machine.pump': {
    role: 'machine',
    form: 'cylinder',
    depthRule: ratio(0.85),
    elevation: 150,
    material: 'steel',
    textMode: 'decal',
    parts: {
      shell: { form: 'cylinder', elevation: 150 },
      impeller: { form: 'decal' },
      outlet: { form: 'pipe', depthRule: mm(120), elevation: 400 },
    },
  },
  'machine.fan': {
    role: 'machine',
    form: 'extrude',
    depthRule: mm(400),
    elevation: 0,
    material: 'steel',
    textMode: 'decal',
    parts: {
      shell: { form: 'extrude' },
      blade: { form: 'decal' },
    },
  },
  'machine.motor': {
    role: 'machine',
    form: 'cylinder',
    depthRule: ratio(0.8),
    elevation: 100,
    material: 'steel',
    textMode: 'decal',
    parts: {
      body: { form: 'cylinder' },
      shaft: { form: 'pipe', depthRule: mm(160) },
      lamp: { form: 'decal' },
      caption: { form: 'decal', role: 'label' },
    },
  },
  'vessel.tank': {
    role: 'vessel',
    form: 'shell',
    depthRule: ratio(1.6),
    elevation: 0,
    material: 'stainless',
    textMode: 'decal',
    parts: {
      shell: { form: 'shell' },
      liquid: { form: 'shell', material: 'liquid', depthRule: ratio(1.45) },
      caption: { form: 'decal', role: 'label' },
      value: { form: 'decal', role: 'label' },
    },
  },
  'pipe.valve': {
    role: 'pipe',
    form: 'extrude',
    depthRule: mm(220),
    elevation: 900,
    material: 'steel',
    textMode: 'decal',
    parts: {
      body: { form: 'extrude' },
      body2: { form: 'extrude' },
      stem: { form: 'pipe', depthRule: mm(180), elevation: 900 },
    },
  },
  'pipe.line-h': {
    role: 'pipe',
    form: 'pipe',
    depthRule: mm(100),
    elevation: 900,
    material: 'steel',
    textMode: 'skip',
  },
  'pipe.line-v': {
    role: 'pipe',
    form: 'pipe',
    depthRule: mm(100),
    elevation: 900,
    material: 'steel',
    textMode: 'skip',
  },
}

/** 按图元分类给出的兜底规则：自定义图元也不会完全没有几何。 */
export const CATEGORY_RULES: Record<string, Part3DRule> = {
  machine: { role: 'machine', form: 'extrude', depthRule: ratio(0.7), elevation: 0, material: 'steel', textMode: 'decal' },
  vessel: { role: 'vessel', form: 'shell', depthRule: ratio(1.4), elevation: 0, material: 'stainless', textMode: 'decal' },
  pipe: { role: 'pipe', form: 'pipe', depthRule: mm(100), elevation: 900, material: 'steel', textMode: 'skip' },
  instrument: { role: 'instrument', form: 'extrude', depthRule: mm(60), elevation: 1300, material: 'plastic', textMode: 'decal' },
  control: { role: 'instrument', form: 'extrude', depthRule: mm(40), elevation: 1200, material: 'plastic', textMode: 'decal' },
  basic: { role: 'structure', form: 'extrude', depthRule: ratio(0.05), elevation: 0, material: 'paint', textMode: 'skip' },
}

/**
 * 规则查询：图元 → 部件级规格。
 *
 * 命中返回 `{ spec, source: 'rule' }`；图元未知但分类已知返回 `heuristic`；
 * 都查不到返回 `null`（由 plan 追参数）。
 */
export function specOf(
  symbol: SymbolLike | undefined,
  partId: string,
  shape: string,
): { spec: Part3DSpec; source: 'rule' | 'heuristic' } | null {
  if (shape === 'text') {
    return {
      spec: { role: 'label', form: 'decal', depthRule: mm(0), elevation: 1500, material: 'none', textMode: 'decal' },
      source: 'rule',
    }
  }
  if (shape === 'path') return null

  const symbolRule = symbol ? SYMBOL_3D_RULES[symbol.key] : undefined
  if (symbolRule) {
    const override = symbolRule.parts?.[partId] ?? {}
    return { spec: mergeRule(symbolRule, override), source: 'rule' }
  }
  const category = symbol?.category ?? ''
  const fallback = CATEGORY_RULES[category]
  if (fallback) return { spec: { ...fallback }, source: 'heuristic' }
  return null
}

function mergeRule(base: Part3DRule, override: Partial<Part3DRule>): Part3DSpec {
  return {
    role: override.role ?? base.role,
    form: override.form ?? base.form,
    depthRule: override.depthRule ?? base.depthRule,
    elevation: override.elevation ?? base.elevation,
    material: override.material ?? base.material,
    textMode: override.textMode ?? base.textMode,
  }
}

/** 厚度策略 → 毫米：比例型按零件较小边换算。 */
export function depthOf(rule: DepthRule, widthMm: number, heightMm: number): number {
  if (rule.mode === 'absolute') return Math.max(0, rule.mm)
  const minSide = Math.min(Math.abs(widthMm), Math.abs(heightMm))
  return Math.max(0, Math.round(minSide * rule.ratio * 10) / 10)
}

/** IFC 实体类型：按角色选最常见的具体子类型，保证 IFC4 校验器认。 */
export function ifcEntityOf(role: PartRole, symbolKey: string, shape: string): string {
  if (symbolKey === 'pipe.line-h' || symbolKey === 'pipe.line-v') return 'IFCPIPESEGMENT'
  if (symbolKey === 'pipe.valve') return 'IFCVALVE'
  if (symbolKey === 'machine.pump') return 'IFCPUMP'
  if (symbolKey === 'machine.fan') return 'IFCFAN'
  if (symbolKey === 'vessel.tank') return 'IFCTANK'
  if (symbolKey === 'machine.motor') return 'IFCFURNISHINGELEMENT'
  if (symbolKey === 'basic.rect') return 'IFCWALL'
  switch (role) {
    case 'pipe':
      return 'IFCPIPESEGMENT'
    case 'vessel':
      return 'IFCTANK'
    case 'machine':
      return 'IFCBUILDINGELEMENTPROXY'
    case 'instrument':
    case 'panel':
      return 'IFCFURNISHINGELEMENT'
    case 'structure':
      return shape === 'polygon' ? 'IFCSLAB' : 'IFCWALL'
    case 'label':
    default:
      return 'IFCANNOTATION'
  }
}

/** 材质 → IFC 里可查的材质名（属性集里用字符串，不建 IFCRELASSOCIATESMATERIAL）。 */
export const MATERIAL_LABEL: Record<ExtrusionMaterial, string> = {
  concrete: 'Concrete',
  steel: 'Steel',
  stainless: 'Stainless Steel',
  glass: 'Glass',
  plastic: 'Plastic',
  paint: 'Painted Finish',
  liquid: 'Process Liquid',
  none: 'None',
}
