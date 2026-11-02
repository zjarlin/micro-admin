# 元素定位：点一下页面就知道源码在哪

标签页顶栏那个「瞄准」按钮（快捷键 **⌘/Ctrl + ⇧ + E**）就是这里的入口。
激活后在页面上点任意元素，右下角会出现一张卡片，直接给出：

- **源码位置**：`src/plugins/scada/pages/ScadaWorkbenchPage.vue:588:9` —— 文件 + 行 + 列，可直接复制；
- **页面来源**：这一页由哪份 schema / 哪个插件提供（配置驱动页面没有 `.vue`，见下文）；
- **组件链**：从最内层组件一路到 `App`，点任一 `src/` 下的文件可在编辑器打开；
- **元素路径**：`div.main-area > main.content-area > … > h1`，用来确认点的是哪一个。

## 为什么不能靠 sourcemap

DevTools 的 sourcemap 只能把「压缩后的 JS 位置」映射回源码，**回答不了「这个 DOM 元素来自哪行模板」**。
要回答这个问题，必须在元素自身上留下标记。因此本项目在**编译期**把位置写进 DOM：

```html
<h1 data-source-loc="src/plugins/scada/pages/ScadaWorkbenchPage.vue:588:9">组态画布</h1>
```

这个属性随构建产物一起发布，所以**生产站点也能定位**，不受压缩、分块、sourcemap 开关影响。

## 四个页面形态都能定位

| 页面形态 | 例子 | 定位结果 |
| --- | --- | --- |
| 手写页面 | `/scada/workbench` | 直接给出页面 `.vue` 的模板行 |
| schema + 自定义插槽 | `/system/user`（`UserPage.vue` 里 `page-key="system.user"`） | 给出渲染壳文件 + `schema key = system.user` |
| 纯配置页面（无 `.vue`） | `/p/demo.device` | 给出通用渲染壳 + `schema key = demo.device` + 基线注册表 `src/schema/registry.ts` |
| 插件注入的组件 | 工作台健康卡 | 给出 `HealthCard.vue`，组件链里能看到 `monitor` 插件 |

配置驱动的页面**没有业务 `.vue`**，所以卡片会额外说明「这一页来自哪个 schema」。改业务规则去
`src/schema/` 或运行期覆盖层，不要在没有业务逻辑的通用壳（`CrudPage.vue`）里找。

## 组件怎么定位

原生元素（`<div>`、`<h1>`）由 `data-source-loc` 直接回答。

组件（`<el-button>`、`<MyCard>`）**故意不写这个属性**——多根组件会丢属性、属性还会透传到第三方 DOM。
它们的位置由**组件链**回答：Vue 在挂载时会往元素上写 `__vueParentComponent`，顺着它向上就能拿到
每个组件的 `__file`。这需要生产构建保留 devtools 元数据，所以 `vite.config.ts` 里开了
`features: { prodDevtools: true }`（只多两个不可枚举属性，体积影响可忽略）。

生产构建的 `__file` 只剩 basename（`AdminLayout.vue`），因此插件会把本地 `.vue` 清单注入 HTML，
由浏览器端做**最长后缀匹配**还原成 `src/layouts/AdminLayout.vue`；同名文件会列出候选，不会猜错目录。

## 代码在哪

| 位置 | 职责 |
| --- | --- |
| `packages/source-locator/src/vite.ts` | 编译期注入属性 + 注入 `.vue` 清单（可独立发布，无业务符号） |
| `packages/source-locator/src/location.ts` | 纯函数：解析位置、组件链、路径归一（无框架依赖） |
| `packages/source-locator/src/browser.ts` | Shadow DOM 覆盖层 + 拾取器（不污染业务页面样式） |
| `src/plugins/source-finder/` | 把这个能力装成插件：服务、顶栏入口、快捷键 |

别的项目要用这套能力，装 `@zjarlin/source-locator` 并按 `packages/source-locator/README.md` 接两行配置即可。

## 已知边界

- **生产站点不能「在编辑器打开」**：`/__open-in-editor` 只有 Vite dev server 提供，生产上点了只会打包；
  拾取器会先探测，不可用时**不显示**这个按钮，只保留「复制位置」，不会给一个点了没反应的入口。
- **动态创建的 DOM 没有标记**：Element Plus 挂在 `body` 上的弹窗、`v-html` 里的内容由 JS 生成，
  卡片会明确写「该元素没有源码标记」，而不是瞎猜一个位置。
- **只覆盖 `.vue` 模板**：`src/*.ts` 里的渲染函数、`h()` 调用不在标记范围内。
