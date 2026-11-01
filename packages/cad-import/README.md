# @addzero/cad-import

CAD 图纸（DXF）→ 组态画布：**本地解析**成实体、归类成组态图元、输出 `scada-dsl` 绘图指令集与摘要。
无 UI 依赖、无第三方 CAD 库，浏览器与 Node 都能直接用。

```ts
import { importCadFile } from '@addzero/cad-import'

const result = importCadFile(dxfText, { canvas: { width: 1920, height: 1080 }, minSize: 6 })
result.commands // 绘图指令集（交给 applyCommands 就是画布文档）
result.digest   // 几十行摘要（给模型做语义补全，不必读原始 DXF）
result.bytes    // { source, commands, digest }：省 token 的实测依据
```

三层可单独用：

| 导出 | 作用 |
| --- | --- |
| `parseDxf` | DXF 文本 → 实体（LINE/POLYLINE/CIRCLE/ARC/ELLIPSE/TEXT/MTEXT/POINT/INSERT） |
| `symbolize` | 实体 → 图元（矩形/管道/圆/三角/线段/文本 + 缩放居中 + 轴向合并） |
| `shapesToCommands` / `shapesDigest` | 图元 → 绘图指令集 / 给模型看的摘要 |

- **DWG 不支持**：二进制 DWG 会被识别并提示「请另存为 DXF（R2000 及以上）」；
- 编码：UTF-8 直读；GBK 图纸按字节传，由调用方用 `TextDecoder('gbk')` 解码；
- 归类只用图元库里真实存在的 key（`basic.*` / `pipe.*`），不会产出画不出来的形状。

用法与实测数字见宿主仓库的 `docs/CAD-IMPORT.md`。
