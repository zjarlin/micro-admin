// 外观主题：把「界面长什么样」做成后端配置，前端只负责写成 CSS 变量。
//
// 谁在用：
// - 外壳（AdminLayout）启动时拉一次，登录后立即生效；
// - 「界面外观」设置区里改完即写回后端并就地应用；
// - 原型设计的人只需要调这里的 token，不需要改组件样式。
//
// 值的唯一来源是服务端 `server/plugins/theme`（`/ui/theme`）；这里的 DEFAULT_THEME
// 只是「后端还没答复时先顶上」的离线兜底，两边必须保持一致。
import { ref } from 'vue'
import type { HttpClient } from './http'

export type UiDensity = 'compact' | 'cozy' | 'comfortable'

/** 侧栏调色板：浅色 / 深色各一套，只暴露 5 个真的会调的，其余派生。 */
export interface SidebarPalette {
  /** 侧栏底色。 */
  bg: string
  /** 普通菜单文字。 */
  text: string
  /** 选中项背景。 */
  activeBg: string
  /** 选中项文字。 */
  activeText: string
  /** 选中项左侧强调条 / 角标底色。 */
  activeBar: string
}

export interface UiTheme {
  brand: string
  brandSoft: string
  accent: string
  radius: number
  density: UiDensity
  appBg: string
  surface: string
  text: string
  muted: string
  /** 浅色模式下的侧栏调色板。 */
  sidebarLight: SidebarPalette
  /** 深色模式下的侧栏调色板。 */
  sidebarDark: SidebarPalette
}

export const DEFAULT_THEME: UiTheme = {
  brand: '#2563eb',
  brandSoft: '#eff6ff',
  accent: '#22d3ee',
  radius: 14,
  density: 'cozy',
  appBg: '#f4f6fa',
  surface: '#ffffff',
  text: '#101828',
  muted: '#667085',
  sidebarLight: {
    bg: '#ffffff',
    text: '#48566e',
    // 选中底比 --brand-soft 再浅一点：出厂状态就要让主色文字过 4.5:1，
    // 不然用户第一次动任何一项，都会触发「文字被偷偷调深」。
    activeBg: '#eff6ff',
    activeText: '#2563eb',
    activeBar: '#2563eb',
  },
  sidebarDark: {
    bg: '#0f172a',
    text: '#a9b6c9',
    activeBg: '#1a335f',
    activeText: '#f8fafc',
    activeBar: '#38bdf8',
  },
}

/** 侧栏的两种模式：配置、预览、应用都按这个顺序走。 */
export const SIDEBAR_MODES = [
  { value: 'light', key: 'sidebarLight', label: '浅色' },
  { value: 'dark', key: 'sidebarDark', label: '深色' },
] as const

export type SidebarMode = (typeof SIDEBAR_MODES)[number]['value']

/** AI 生成只覆盖这些扁平字段；侧栏是整块结构，交给面板单独调。 */
export type ThemeScalarKey = 'brand' | 'brandSoft' | 'accent' | 'radius' | 'density' | 'appBg' | 'surface' | 'text' | 'muted'

export const THEME_SCALAR_KEYS: ThemeScalarKey[] = [
  'brand', 'brandSoft', 'accent', 'radius', 'density', 'appBg', 'surface', 'text', 'muted',
]

/** 主题里有嵌套对象，浅拷贝会让多处共享同一份侧栏调色板，必须整体克隆。 */
export function cloneTheme(theme: UiTheme): UiTheme {
  return {
    ...theme,
    sidebarLight: { ...theme.sidebarLight },
    sidebarDark: { ...theme.sidebarDark },
  }
}

export function defaultTheme(): UiTheme {
  return cloneTheme(DEFAULT_THEME)
}

/** 当前生效的主题：多处共享一份，改完立刻重渲染。 */
const current = ref<UiTheme>(defaultTheme())

export function useTheme() {
  return current
}

// ---------------- 颜色计算 ----------------

function toRgb(hex: string): [number, number, number] {
  const text = hex.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return [0, 0, 0]
  return [
    parseInt(text.slice(1, 3), 16),
    parseInt(text.slice(3, 5), 16),
    parseInt(text.slice(5, 7), 16),
  ]
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

/** 按 `weight`（0~1，表示 a 的占比）把两种颜色线性混合。 */
function mix(a: string, b: string, weight: number): string {
  const [r1, g1, b1] = toRgb(a)
  const [r2, g2, b2] = toRgb(b)
  return `#${toHex(r1 * weight + r2 * (1 - weight))}${toHex(g1 * weight + g2 * (1 - weight))}${toHex(b1 * weight + b2 * (1 - weight))}`
}

function alpha(hex: string, value: number): string {
  const [r, g, b] = toRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${value})`
}

/** 感知亮度够不够暗：决定文字往黑里压还是往白里提。 */
function isDark(hex: string): boolean {
  const [r, g, b] = toRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
}

/** 压在同色底上的可读文字色（角标用）。 */
function readableText(hex: string): string {
  return isDark(hex) ? '#ffffff' : '#0b1220'
}

/** WCAG 相对亮度与对比度：用来判断「这行字压在换个底色还看不看得清」。 */
function luminance(hex: string): number {
  const channel = (value: number): number => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = toRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  const hi = Math.max(first, second)
  const lo = Math.min(first, second)
  return (hi + 0.05) / (lo + 0.05)
}

/** 把前景色朝黑/白推，直到压在该底色上够读（WCAG 4.5:1）；推不动就退回纯黑/纯白。 */
function readableOn(foreground: string, background: string, min = 4.5): string {
  if (contrastRatio(foreground, background) >= min) return foreground
  const target = isDark(background) ? '#ffffff' : '#000000'
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mix(foreground, target, 1 - step / 10)
    if (contrastRatio(candidate, background) >= min) return candidate
  }
  return target
}

/**
 * 选中行的底色是渐变，文字要「整条都够读」，所以必须对两个色标都成立。
 *
 * 只校验渐变起点会出现「左边看得清、右边糊成一片」——实测过。
 */
export function activeRowStops(palette: SidebarPalette): [string, string] {
  // 末标只往底色偏 15%：偏太多就成了「深→浅」的断层，任何单一文字色都不可能两头都读得清。
  return [palette.activeBg, mix(palette.activeBg, palette.bg, 0.85)]
}

/** 前景色在若干个背景上都够读时返回它，否则朝黑/白推直到全部满足。 */
function readableOnAll(foreground: string, backgrounds: string[], min = 4.5): string {
  const ok = (candidate: string): boolean => backgrounds.every((bg) => contrastRatio(candidate, bg) >= min)
  if (ok(foreground)) return foreground
  const target = backgrounds.every((bg) => isDark(bg)) ? '#ffffff' : '#000000'
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mix(foreground, target, 1 - step / 10)
    if (ok(candidate)) return candidate
  }
  return target
}

/**
 * 换底色后自动把文字调到还能读，避免「底色调深了、字还是深灰」。
 *
 * 只在底色变化时兜一次底；用户随后手动改的字不再被覆盖。
 * 返回是否动过，供调用方决定要不要提示。
 */
export function ensureReadable(palette: SidebarPalette): boolean {
  // 两层一起校正：渐变末标由底色算出，改底色同样会让选中项文字失效。
  const nextText = readableOn(palette.text, palette.bg)
  const nextActive = readableOnAll(palette.activeText, activeRowStops(palette))
  const changed = nextText !== palette.text || nextActive !== palette.activeText
  palette.text = nextText
  palette.activeText = nextActive
  return changed
}

/**
 * 把 5 个可调色算成侧栏要用的整组 `--sidebar-*` 令牌。
 *
 * 派生规则集中在这里：面板的实时预览和真实侧栏吃的是同一份结果，
 * 不会出现「预览好看、放上去不一样」。返回值就是可以整体写进 style 的键值对。
 */
export function sidebarTokens(palette: SidebarPalette): Record<string, string> {
  const dark = isDark(palette.bg)
  return {
    '--sidebar-bg': palette.bg,
    '--sidebar-text': palette.text,
    '--sidebar-active-bg': `linear-gradient(90deg, ${activeRowStops(palette).join(', ')})`,
    '--sidebar-active-text': palette.activeText,
    '--sidebar-active-bar': palette.activeBar,
    // 以下是派生：轻一点的底、分隔线、悬停底、次要文字、角标。
    '--sidebar-bg-soft': mix(palette.text, palette.bg, 0.06),
    '--sidebar-line': dark ? alpha(palette.text, 0.14) : mix(palette.text, palette.bg, 0.13),
    '--sidebar-line-strong': dark ? alpha(palette.text, 0.3) : mix(palette.text, palette.bg, 0.27),
    '--sidebar-text-strong': dark ? mix(palette.text, '#ffffff', 0.3) : mix(palette.text, '#000000', 0.55),
    '--sidebar-muted': mix(palette.text, palette.bg, dark ? 0.66 : 0.55),
    '--sidebar-hover-bg': dark ? alpha(palette.text, 0.1) : mix(palette.text, palette.bg, 0.08),
    '--sidebar-scrollbar': alpha(palette.text, 0.3),
    '--sidebar-badge-bg': palette.activeBar,
    '--sidebar-badge-text': readableText(palette.activeBar),
  }
}

/**
 * 主色变了以后，仍然「跟着主色」的侧栏选中色同步改；用户手动调过的保持不动。
 * 判据是「当前值等于改之前的主色」——这样默认观感始终协调，改过就尊重用户。
 */
export function followBrand(theme: UiTheme, previousBrand: string): void {
  for (const mode of SIDEBAR_MODES) {
    const palette = theme[mode.key]
    if (palette.activeBar === previousBrand) palette.activeBar = theme.brand
    if (palette.activeText === previousBrand) palette.activeText = theme.brand
  }
}

// ---------------- 应用到 DOM ----------------

function upsertStyle(id: string, css: string): void {
  let style = document.getElementById(id) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  style.textContent = css
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([key, value]) => `${key}:${value};`).join('')
}

/**
 * 把主题写成 CSS 变量。
 *
 * 品牌色 / 圆角 / 密度写在 `:root` 的内联样式上——它们在浅色和深色下都要生效。
 * 背景、表面、正文、次要文字、以及两套侧栏调色板只属于各自的模式：写成
 * `:root:not(.dark)` / `:root.dark` 规则，而不是内联样式。否则深色模式下内联值会盖住
 * `html.dark` 的调色板（表现就是「切了深色，右侧面板和卡片还是白的」）。
 */
export function applyTheme(theme: UiTheme, dark: boolean): void {
  current.value = cloneTheme(theme)
  const root = document.documentElement
  root.style.setProperty('--brand', theme.brand)
  root.style.setProperty('--brand-soft', theme.brandSoft)
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--radius', `${theme.radius}px`)
  root.style.setProperty('--content-pad', theme.density === 'compact' ? '18px' : theme.density === 'comfortable' ? '32px' : '28px')
  root.dataset.density = theme.density

  upsertStyle(
    'ui-theme-light-tokens',
    `:root:not(.dark){--app-bg:${theme.appBg};--surface:${theme.surface};`
      + `--app-text:${theme.text};--muted:${theme.muted};`
      + `${declarations(sidebarTokens(theme.sidebarLight))}}`,
  )
  // `:root.dark` 的优先级高于基础样式里的 `html.dark`，不需要额外加 !important。
  upsertStyle('ui-theme-dark-tokens', `:root.dark{${declarations(sidebarTokens(theme.sidebarDark))}}`)

  // 深色标记由调用方负责（store 的 apply 已处理），这里只用它做一次自检清理。
  if (dark) {
    for (const token of ['--app-bg', '--surface', '--app-text', '--muted']) root.style.removeProperty(token)
  }
}

// ---------------- 读写后端 ----------------

export interface ThemeResponse {
  theme: UiTheme
  defaults: UiTheme
}

function merge(raw: Partial<UiTheme> | null | undefined): UiTheme {
  const base = defaultTheme()
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base,
    ...raw,
    sidebarLight: { ...base.sidebarLight, ...(raw.sidebarLight ?? {}) },
    sidebarDark: { ...base.sidebarDark, ...(raw.sidebarDark ?? {}) },
  }
}

/** 读后端主题；失败时回落到默认值，界面不因为主题接口挂掉而白屏。 */
export async function loadTheme(http: HttpClient): Promise<UiTheme> {
  try {
    const response = await http.request<ThemeResponse>('/ui/theme')
    return merge(response.theme)
  } catch {
    return defaultTheme()
  }
}

export async function saveTheme(http: HttpClient, theme: UiTheme): Promise<UiTheme> {
  const response = await http.request<ThemeResponse>('/ui/theme', {
    method: 'PUT',
    body: JSON.stringify(theme),
  })
  return merge(response.theme)
}
