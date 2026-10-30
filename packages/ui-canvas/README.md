# @zjarlin/ui-canvas：2D 图纸 → 可运行页面

把「UI 设计师画的那张 2D 图纸」当作页面的唯一真源：图纸编译成 `CrudPageSchema`，
发布即 `PUT /ui/pages/{key}`，前端不需要为每个页面发版。

## 为什么不需要第二套运行时

仓库里已经有一条完整链路：

```
图纸 ──compileDrawing──▶ CrudPageSchema ──PUT /ui/pages/{key}──▶ 注册表 ──/ui/pages──▶ 前端自动挂路由+菜单
```

`CrudPageSchema` 就是这套系统的中间表示（IR），`createStoredRegistry` 运行期可写，
`pagesPlugin` 已经把「后端登记一页 → 前端自动出现」跑通了。本包只补最前面那一段：
**把图纸翻译成 IR**，顺带把「翻译不了的地方」变成可执行的追问。

## 三层

| 文件 | 说明 |
| --- | --- |
| `roles.ts` | 元素角色表 L0：每个角色是什么、默认属性、可配属性白名单、可挂通道、预览色 |
| `layout.ts` | 几何装配：谁属于哪个区域、按什么顺序、该多宽、表单该占半行还是整行 |
| `compile.ts` | 图纸 → `CrudPageSchema`，附诊断与 `questions`（只发缺的字段） |
| `vibe.ts` | vibeelement：通道契约、绑定校验、模板安全检查、运行时模型装配 |
| `render.ts` | 线框缩略图（服务端批量出图）与区域对照 |

## 元素分层

- **容器层**（page / header / toolbar / filter / table / form / tree / footer / tabs / card）：
  决定页面骨架，靠几何包含关系装配；
- **叶层**（column / field / query / action）：真正产出 schema 片段，顺序和宽度都从几何来；
- **装饰层**（text / chart / stat / detail）：不改行为，富内容角色超出当前页面形态时落成诊断。

## vibeelement

普通图元和 vibeelement 的区别只有两条：

1. **实时**：元素带 `props.code`（模板片段）与 `bindings`（数据/事件通道），改一处即时重渲；
2. **可绑**：数据通道（值从哪来）与事件通道（点了做什么）都是声明式的，因此能存进 JSON、
   由服务端下发、在任意壳里执行——不需要把函数序列化。

模板是**模板**不是脚本：`inspectCode` 禁掉 `<script>` / `v-html` / `eval` / 动态 import /
直接访问 document·window，`@click` 只允许指向已注册的通道方法名。这一层让模板可以安全下发。

## 用法

```ts
import { compileDrawing, renderWireframe } from '@zjarlin/ui-canvas'

const compiled = compileDrawing(drawing)
if (compiled.questions.length) {
  // 只把 questions 发给模型，拿回字段再写回图纸，重新编译
}
await http.request(`/ui/pages/${compiled.key}`, { method: 'PUT', body: JSON.stringify(compiled.schema) })
const thumb = renderWireframe(drawing, { maxWidth: 320, maxHeight: 240 })
```
