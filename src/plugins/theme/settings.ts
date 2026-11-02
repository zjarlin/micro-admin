import type { SettingSectionContribution } from '@/kernel'
import ThemeSettingsPanel from './components/ThemeSettingsPanel.vue'

/**
 * 外观主题的设置贡献。
 *
 * 用自定义面板而不是声明式字段：调色要「改一个值立即预览」，
 * 字段渲染器只负责表单，不适合承载实时预览与 AI 生成这类交互。
 */
export const themeSettings: SettingSectionContribution = {
  id: 'theme:settings',
  group: { id: 'appearance', title: '界面外观', order: 10, icon: 'Brush' },
  title: '外观主题',
  description: '品牌色、圆角、密度都存在后端，改完全站生效；这里调的是「一套界面的骨架」，页面本身仍然由 schema 决定。',
  order: 10,
  permission: 'system:theme:config',
  component: ThemeSettingsPanel,
}
