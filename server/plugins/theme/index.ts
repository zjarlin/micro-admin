// 外观主题（服务端）：把「界面长什么样」变成可存可改的配置。
//
// 原型设计的人不写代码也要能调界面：品牌色、圆角、密度、背景/表面色都收在这里，
// 前端启动时拉一次并写成 CSS 变量，刷新即生效。
import type { ExtensionRequest, ExtensionUser, KeyValueStore } from '@zjarlin/ui-server'

export const UNHANDLED = Symbol('theme-unhandled')

export type UiDensity = 'compact' | 'cozy' | 'comfortable'

/**
 * 侧栏调色板：侧栏是独立的一块界面，浅色/深色各一套，不跟内容区的 surface 走。
 *
 * 只暴露 5 个「用户真的会调」的底色/文字/选中态，其余（分隔线、悬停底、次要文字、
 * 角标）由前端按这 5 个算出派生令牌——所以这里不用堆二十个字段。
 */
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
  /** 主色：按钮、选中态、强调线。 */
  brand: string
  /** 主色浅底：选中背景、标签页。 */
  brandSoft: string
  /** 辅助色：渐变与图表。 */
  accent: string
  /** 圆角（px）。 */
  radius: number
  /** 密度：影响内容留白与表格行高。 */
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

const THEME_PERMISSION = 'system:theme:config'
const KEY = 'ui:theme'

function allowed(user: ExtensionUser | null, permission: string): boolean {
  if (!user) return false
  return user.permissions.includes('*:*:*') || user.permissions.includes('*') || user.permissions.includes(permission)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function color(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback
}

function palette(value: unknown, base: SidebarPalette): SidebarPalette {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<SidebarPalette>
  return {
    bg: color(raw.bg, base.bg),
    text: color(raw.text, base.text),
    activeBg: color(raw.activeBg, base.activeBg),
    activeText: color(raw.activeText, base.activeText),
    activeBar: color(raw.activeBar, base.activeBar),
  }
}

/** 把任意输入收敛成合法主题：非法字段回落到默认值，而不是整份拒绝。 */
export function normalizeTheme(input: unknown, base: UiTheme = DEFAULT_THEME): UiTheme {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<UiTheme>
  const density: UiDensity = raw.density === 'compact' || raw.density === 'comfortable' ? raw.density : 'cozy'
  return {
    brand: color(raw.brand, base.brand),
    brandSoft: color(raw.brandSoft, base.brandSoft),
    accent: color(raw.accent, base.accent),
    radius: clampInt(raw.radius, 0, 20, base.radius),
    density,
    appBg: color(raw.appBg, base.appBg),
    surface: color(raw.surface, base.surface),
    text: color(raw.text, base.text),
    muted: color(raw.muted, base.muted),
    // 老数据没有侧栏字段时整块回落出厂调色板，不需要迁移脚本。
    sidebarLight: palette(raw.sidebarLight, base.sidebarLight),
    sidebarDark: palette(raw.sidebarDark, base.sidebarDark),
  }
}

export interface ThemePlugin {
  handle(request: ExtensionRequest): unknown | typeof UNHANDLED
}

export function createThemePlugin(options: { kv: KeyValueStore }): ThemePlugin {
  const read = (): UiTheme => normalizeTheme(options.kv.get<UiTheme>(KEY))

  return {
    handle({ method, path, body, user }) {
      if (path !== '/ui/theme') return UNHANDLED
      if (method === 'GET') return { theme: read(), defaults: DEFAULT_THEME }
      if (method === 'PUT' || method === 'POST') {
        if (!allowed(user, THEME_PERMISSION)) {
          throw Object.assign(new Error(`缺少外观配置权限：${THEME_PERMISSION}`), { status: 403 })
        }
        const next = normalizeTheme(body, DEFAULT_THEME)
        options.kv.set(KEY, next)
        return { theme: next }
      }
      return UNHANDLED
    },
  }
}
