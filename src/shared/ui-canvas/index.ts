// 图纸能力的统一入口。
//
// 实现在 workspace 包 `packages/ui-canvas`（可独立发布）；这里用相对导入，
// 与 `src/shared/scada/ifc.ts` 同一做法——其余代码只认 `@/shared/ui-canvas`，
// 等发布名固定后把这一行换成包名即可，调用方不需要跟着改。
export * from '../../../packages/ui-canvas/src/index.ts'
