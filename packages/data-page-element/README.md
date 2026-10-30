# @addzero/data-page-element

`@addzero/data-page` 的 Element Plus 适配层：把 schema 渲染成查询栏、表格、分页、
行操作、表单弹窗与左树。

## 安装

```bash
pnpm add @addzero/data-page-element
# peer：@addzero/data-page、element-plus ^2.14、@element-plus/icons-vue ^2.3、vue ^3.5
```

## 用法

```ts
import { installDataPage } from '@addzero/data-page-element'

// 一次装配：注入传输实现 + 全局注册 SchemaPage / CrudPage / TreePage
installDataPage(app, { transport: http })
```

```vue
<SchemaPage page-key="system.user" :can="session.can" />
```

也可以不用全局注册，逐组件传 `transport`：

```vue
<SchemaPage page-key="demo.device" :transport="http" />
```

## 组件

| 组件 | 用途 |
| --- | --- |
| `SchemaPage` | 按 key 取 schema 再渲染；形态由 schema 决定 |
| `CrudPage` | 筛选 + 分页表 + 弹窗；有 `tree` 即左树右表 |
| `TreePage` | 按层级展开的树表（部门、菜单） |

## 设计约定

- 必填字段的 `*` 与校验文案同源（`@addzero/data-page` 的 `rulesOf`），不在壳里另写。
- 解释性文字走标签旁 `?` 浮层（`HelpHint`），不占正文。
- `custom` 单元格优先用宿主插槽，**没有插槽时退回文本**——后端新加的列不会显示空白。
- 传输实现缺失直接抛错，而不是渲染空表：配置驱动的页面拿不到数据必须立刻可见。
- 固定列（操作列）的底色由包内 `src/table-shell.css` 统一给出，随 `index.ts` 引入一次：
  Element Plus 只给 sticky 单元格 `background: inherit` 且带 0.25s 底色过渡，深浅色快速切换时
  会停在中间色，表现为操作列一条灰黑竖带。宿主不要另写一份固定列样式；单独引用组件（不经过
  `index.ts`）时请额外 `import '@addzero/data-page-element/table-shell.css'`。
