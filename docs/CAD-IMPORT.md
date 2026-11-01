# CAD 图纸 → 组态画面（DXF / DWG 导入）

丢一个 `.dxf` 或 `.dwg` 进工作台，直接得到一张可编辑的组态画面。整条链路**默认不花一个 token**：
图纸由本地解析器读成图元，再输出成 `scada-dsl` 绘图指令集；只有「这堆框里哪个是泵」这类
语义判断才交给模型，模型读的是几十行摘要，不是整份图纸。

```
DXF 文本 ──parseDxf────────────────┐
DWG 字节 ──libredwg(wasm)──adapt──▶ 实体（LINE/POLYLINE/CIRCLE/ARC/ELLIPSE/TEXT/INSERT…）
                                   ──symbolize──▶ 组态图元（基础图元/管道/文本）
                                   ──shapesToCommands──▶ 绘图指令集（applyCommands 直接执行）
                                   ──shapesDigest──▶ 摘要（固定几十行，喂给模型做语义补全）
```

## 分三层，每层都能单独用

包 `packages/cad-import`（`@addzero/cad-import`，无 UI 依赖，可单独发布）：

| 文件 | 职责 |
| --- | --- |
| `src/dxf.ts` | DXF 文本 → 实体。自己写的解析器：只认画图需要的组码，不引 CAD 内核 |
| `src/geometry.ts` | 两条解析链共用的几何原语：块变换、bulge/弧/椭圆折线化、包围盒、文字清洗 |
| `src/dwg.ts` | `DwgDatabase` → 实体（纯函数，不碰 wasm，可脱离依赖复用） |
| `src/dwg-reader.ts` | 字节 → `DwgDatabase`（**唯一接触 GPL 依赖的地方**，可选、动态加载） |
| `src/symbolize.ts` | 实体 → 图元：归类、轴向合并、缩放居中、稳健取景 |
| `src/commands.ts` | 图元 → 绘图指令集 / 摘要（`shapesToCommands`、`shapesDigest`） |
| `src/index.ts` | 门面 `importCadFile(text)` / `symbolizeDrawing(drawing)` → `{ drawing, symbolized, commands, digest, warnings, bytes }` |

宿主侧只认一个入口：`src/shared/scada/cad.ts`（`export * from packages/cad-import`，与 `ifc.ts` 同一写法）。

## 支持范围

支持：`LINE` / `LWPOLYLINE` / `POLYLINE` / `CIRCLE` / `ARC` / `ELLIPSE` / `TEXT` / `MTEXT` /
`POINT` / `INSERT`（含嵌套块，深度 8、总展开 5000 上限保护）。
跳过并记 warning：`HATCH` / `DIMENSION` / `SPLINE` 等——组态画面用不到，报错反而挡住正常图纸。

**DWG 直接支持**（R13~2018）：字节交给 `@mlightcad/libredwg-web`（GNU LibreDWG 的 WASM 移植，
**GPL-3.0**），得到 `DwgDatabase` 后由 `src/dwg.ts` 适配成与 DXF 同形状的实体，**下游一条代码**。
实测 `AC1015` / `AC1027` / `AC1032` 三个版本同一张图解析结果逐项一致。

格式判定一律按**字节魔数**（`AC10xx` + 6 个保留字节），不看扩展名——把 `.dwg` 改名成 `.dxf`
一样走 DWG 分支（前后端都用同一个 `detectCadFormat`）。

> 这里踩过一次坑：早期写成 `text.trimStart()` 后判 `^\x00`，而 DWG 头是 `AC1015\0\0`，
> 第 1 个字符是 `A` 不是 NUL，于是**永远不命中**；真实 DWG 会被按文本解一遍，
> 报出「DXF 里没有 ENTITIES 段」这种把人带偏的错。

### 关于 GPL 与体积

- `@mlightcad/libredwg-web` 是 **optionalDependency**：没装时 DWG 导入报「解析组件未安装」，
  DXF 链路完全不受影响；服务端只在遇到 `.dwg` 时才 `import()`，11MB wasm 不进前端产物、不拖慢冷启动。
- 许可为 **GPL-3.0**（上游 LibreDWG 如此）。本项目按 GPL 兼容方式分发该组件；把它当独立程序使用时，
  链接关系只发生在服务端进程内，需要留意与本仓库许可的一致性。
- 版本**必须**是 `0.8.3`：`0.8.0/0.8.1/0.8.2` 的 wasm 一读文件就 `memory access out of bounds`（三版实测），
  因此 `pnpm-workspace.yaml` 里对它做了精确版本的 `minimumReleaseAgeExclude` 豁免（只放这一个版本）。
- 该库的 `dwg_write_dxf`（DWG→DXF 文本）在这个构建里是坏的（`null function or function signature mismatch`），
  所以没有走「先转 DXF 再解析」，而是直接适配数据库。

编码：UTF-8 直读；国内 CAD 常见的 GBK 走 base64 上传，服务端用 `TextDecoder('gbk')` 重解。

## 归类规则（为什么导入出来「像那张图」而不是像矢量编辑器）

1. **闭合且四边贴包围盒 → `basic.rect`**（`radius=0`：图纸上的设备框都是直角）；
2. **长宽比 ≥ 6 的闭合框 → `pipe.line-h` / `pipe.line-v`**（CAD 里画管道常是一个细长矩形）；
3. **3 点闭合 → `basic.triangle`**；圆/椭圆 → `basic.ellipse`；
4. **轴向线段合并**：同图层、同轴、端点相接的多段线合成一条管道（夹角 ≤12° 吸附成水平/垂直）；
   斜线保留为 `basic.line`（最小包围盒）；
5. **TEXT/MTEXT → `basic.text`**，字号按图纸字高换算；落在矩形内的文字顺带成为该矩形的 `name`。

坐标口径：DXF 的 y 轴向上、画布 y 轴向下，因此翻转 y；再按图纸包围盒等比缩放、四周留 32px 并居中。

**取景是稳健的**：真实图纸里常有离主体几百倍远的实体（块缩放炸掉的标注、误画的辅助线）。
按全量包围盒取景会把主体缩成一个点（实测一张图被一个 1e6 外的块拖到缩放比 0.000，几何全被丢弃），
因此 `symbolize` 会按**实体包围盒**做分位判断，主体比全量小 5 倍以上时改用主体范围取景，
并把「离主体 2 倍以内」的实体捞回来。正常图纸走全量包围盒，行为不变。

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

DWG 样例（LibreDWG 官方测试图 `example_2000.dwg`，AC1015，含嵌套块/属性块/圆角多段线/极端缩放块）：

| 量 | 值 |
| --- | --- |
| 源文件 | 582,572 字节 |
| 解析 | 61 实体 → 展开 141（块 16 个、深 8 层保护） |
| 取景 | 5 个离主体 475 倍远的实体被剪掉（缩放比 0.102 而不是 0.000） |
| 实体 141 → 图元 95（合并 7,265 段） | `line 44 · pipe-h 22 · pipe-v 16 · circle 9 · text 4` |
| 绘图指令集 | 5,770 字节（100 条指令） |
| 摘要（模型读这份） | 2,335 字节 |

指令约为源文件的 **1/101**；同一张图在 AC1015 / AC1027 / AC1032 三个版本下解析结果逐项一致。

| 版本 | 结果 |
| --- | --- |
| `AC1015`（R2000） | 61 → 141 实体，95 图元 |
| `AC1027`（R2013） | 同上 |
| `AC1032`（R2018） | 同上 |
| `AC1014`（R14） | 读出 0 实体 → 明确报错「文件可能损坏/加密/版本过老」 |

## 前端

工具条「导入图纸」按钮 → `src/components/scada/ScadaCadImportDialog.vue`：

- 拖放/选择 `.dxf` 或 `.dwg`（按字节判格式，改名也认）；二进制 DXF 在选文件阶段就提示转存；
- 选项：目标画布（1920×1080 / 1600×900 / 1366×768 / 2560×1440）、最小图形尺寸、图层勾选；
- 预览：实体数 / 图元数 / 合并数 / 丢弃数 + **体积对比**（源 → 指令 → 摘要）+ 指令前 18 行；
- 两个动作：**直接应用**（只落几何）、**AI 补语义**（先落几何，再让模型换设备图元/接变量/改名）。

应用后只置 `dirty`，不自动保存——与工具条其它改动一致，用户点「保存」才落库。

## 已处理的坑

- **组码 70 是位标记**：`1` 是闭合、`128` 是「有 bulge」；当布尔读会把带弧多段线判成闭合；
- **bulge 属于「从该顶点出发的那一段」**：早期实现把它用在「上一顶点 → 本顶点」上，整整差一段
  （没有 bulge 的图纸看不出来，一带圆角就错位；实测一条 100 单位的半圆被画到了 -50~0 一侧）；
- **DWG 的角与 DXF 不同单位**：libredwg 的 `ARC.startAngle`、`ELLIPSE`、`MTEXT.rotation`、
  `INSERT.rotation` 都是**弧度**，`TEXT.rotation` 却是度（同一库里两个转换分支不一致）；
- **ATTRIB 已经是世界坐标**：libredwg 按插入点/缩放/旋转定位过属性文字，再套一次块变换会得到
  「3.4 亿高的文字」，整张图被撑爆、缩放比归零、几何全被丢弃；
- **`Dwg_File_Type.DWG` 的值是 0 不是 1**（传 1 会被当成 DXF，读出 0 实体）；
- **DWG 的实体要从模型空间块取**：顶层 `db.entities` 会混进 `ATTRIB`/`VIEWPORT`，当图纸实体会重复画；
- **`JSON.stringify(database)` 会抛**（handle 字段是 BigInt），调试时别直接打印整库；
- **DWG 魔数不能靠文本判断**：`AC1015\0\0` 的首字符是 `A`，`trimStart()` 后判 `^\x00` 恒假；
  必须直接用原始字节判，且要判满 `AC10` + 2 位版本号（测试样本 582KB 的 `AC1015` 曾经就这样漏判）；
- **只解析 `ENTITIES` 段**：连 `BLOCKS` 一起解析会让块内实体再画一遍（第一版实测「每根管出现两次」）；
- 圆弧分段 12 段、bulge 6 段：再多只是把实体数翻几倍，画面上看不出差别。

## 提示词

`server/plugins/ai/prompts.ts` 的 `scada.cad`（可在「AI 设置」里改、可恢复默认）：
只要求模型做四件事——换设备图元（tank/pump/fan/motor/valve）、接能确定语义的变量、把占位名改中文、
把文字压到最上层。硬约束是「不改画布尺寸、不移动位置、不 add 摘要里没有的设备、最多 40 条指令」。
