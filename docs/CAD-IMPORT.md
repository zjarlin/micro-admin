# CAD 图纸 → 组态画面（DXF 导入）

丢一个 `.dxf` 进工作台，直接得到一张可编辑的组态画面。整条链路**默认不花一个 token**：
DXF 由本地解析器读成图元，再输出成 `scada-dsl` 绘图指令集；只有「这堆框里哪个是泵」这类
语义判断才交给模型，模型读的是几十行摘要，不是整份图纸。

```
DXF 文本 ──parseDxf──▶ 实体（LINE/POLYLINE/CIRCLE/ARC/ELLIPSE/TEXT/INSERT…）
        ──symbolize──▶ 组态图元（18 个内置 key 里的基础图元/管道/文本）
        ──shapesToCommands──▶ 绘图指令集（applyCommands 直接执行）
        ──shapesDigest──▶ 摘要（固定几十行，喂给模型做语义补全）
```

## 分三层，每层都能单独用

包 `packages/cad-import`（`@addzero/cad-import`，无 UI 依赖，可单独发布）：

| 文件 | 职责 |
| --- | --- |
| `src/dxf.ts` | DXF 文本 → 实体。自己写的解析器：只认画图需要的组码，不引 CAD 内核 |
| `src/symbolize.ts` | 实体 → 图元：归类、轴向合并、缩放居中 |
| `src/commands.ts` | 图元 → 绘图指令集 / 摘要（`shapesToCommands`、`shapesDigest`） |
| `src/index.ts` | 门面 `importCadFile(text, options)` → `{ drawing, symbolized, commands, digest, warnings, bytes }` |

宿主侧只认一个入口：`src/shared/scada/cad.ts`（`export * from packages/cad-import`，与 `ifc.ts` 同一写法）。

## 支持范围

支持：`LINE` / `LWPOLYLINE` / `POLYLINE` / `CIRCLE` / `ARC` / `ELLIPSE` / `TEXT` / `MTEXT` /
`POINT` / `INSERT`（含嵌套块，深度 8、总展开 5000 上限保护）。
跳过并记 warning：`HATCH` / `DIMENSION` / `SPLINE` 等——组态画面用不到，报错反而挡住正常图纸。

**DWG 不支持**：二进制 DWG 会被识别并提示「请另存为 DXF（R2000 及以上）」。
编码：UTF-8 直读；国内 CAD 常见的 GBK 走 base64 上传，服务端用 `TextDecoder('gbk')` 重解。

## 归类规则（为什么导入出来「像那张图」而不是像矢量编辑器）

1. **闭合且四边贴包围盒 → `basic.rect`**（`radius=0`：图纸上的设备框都是直角）；
2. **长宽比 ≥ 6 的闭合框 → `pipe.line-h` / `pipe.line-v`**（CAD 里画管道常是一个细长矩形）；
3. **3 点闭合 → `basic.triangle`**；圆/椭圆 → `basic.ellipse`；
4. **轴向线段合并**：同图层、同轴、端点相接的多段线合成一条管道（夹角 ≤12° 吸附成水平/垂直）；
   斜线保留为 `basic.line`（最小包围盒）；
5. **TEXT/MTEXT → `basic.text`**，字号按图纸字高换算；落在矩形内的文字顺带成为该矩形的 `name`。

坐标口径：DXF 的 y 轴向上、画布 y 轴向下，因此翻转 y；再按图纸包围盒等比缩放、四周留 32px 并居中。

## 接口

```
POST /scada/cad/import   { fileName, content, base64?, options{canvas,layers,minSize,maxShapes,snapAngle} }
  → { drawing, stats, canvas, scale, shapes, commands, digest, warnings, bytes }
POST /scada/cad/apply    { document, commands }
  → { document, applied, issues }        # 与 /ai/draw 同一个 applyCommands
POST /ai/draw            { promptId:'scada.cad', prompt, digest, document, symbols, tags }
  → { document, applied, issues, commands, model, usage }   # 语义补全，读摘要不读 DXF
```

`/scada/cad/import` **不落库**：前端先看预览与体积对比，确认后才写画面（也就不会悄悄改掉用户的画面）。
指令集统一走 `@addzero/scada-dsl` 的 `applyCommands`，所以「CAD 转出来的画面」与「AI 画的画面」
是同一份中间表示、同一个执行器。

## 省 token 的实测数字

样例 `sample-pid.dxf`（R2010、mm、含块引用/隐藏图框图层/带 bulge 弯管/MTEXT/HATCH）：

| 量 | 值 |
| --- | --- |
| 源文件 | 40,645 字节 |
| 实体 32 → 图元 21（合并 14 段，丢弃 0） | `rect 2 · circle 1 · triangle 5 · pipe-h 4 · pipe-v 3 · line 2 · text 4` |
| 绘图指令集 | 1,511 字节（28 行） |
| 摘要（模型读这份） | 1,212 字节 |

指令约为源文件的 **1/27**；摘要同样是 1/27 量级。图纸再大，摘要也固定压到几十行（默认 40 条几何 + 20 条文字），
所以「一张图纸」的 token 成本与图纸行数无关。

## 前端

工具条「导入图纸」按钮 → `src/components/scada/ScadaCadImportDialog.vue`：

- 拖放/选择 `.dxf`；`.dwg` 直接提示另存为 DXF；
- 选项：目标画布（1920×1080 / 1600×900 / 1366×768 / 2560×1440）、最小图形尺寸、图层勾选；
- 预览：实体数 / 图元数 / 合并数 / 丢弃数 + **体积对比**（源 → 指令 → 摘要）+ 指令前 18 行；
- 两个动作：**直接应用**（只落几何）、**AI 补语义**（先落几何，再让模型换设备图元/接变量/改名）。

应用后只置 `dirty`，不自动保存——与工具条其它改动一致，用户点「保存」才落库。

## 已处理的坑

- **组码 70 是位标记**：`1` 是闭合、`128` 是「有 bulge」；当布尔读会把带弧多段线判成闭合；
- **LWPOLYLINE 的 bulge 跟随在顶点之后**（组码 42），漏读就把圆角管道画成直角；
- **只解析 `ENTITIES` 段**：连 `BLOCKS` 一起解析会让块内实体再画一遍（第一版实测「每根管出现两次」）；
- 圆弧分段 12 段、bulge 6 段：再多只是把实体数翻几倍，画面上看不出差别。

## 提示词

`server/plugins/ai/prompts.ts` 的 `scada.cad`（可在「AI 设置」里改、可恢复默认）：
只要求模型做四件事——换设备图元（tank/pump/fan/motor/valve）、接能确定语义的变量、把占位名改中文、
把文字压到最上层。硬约束是「不改画布尺寸、不移动位置、不 add 摘要里没有的设备、最多 40 条指令」。
