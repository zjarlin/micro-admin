// 外壳能力的统一入口：图纸模型与编译器都在 workspace 包 `packages/ui-canvas`（可独立发布）。
//
// 与 `@/shared/ui-canvas` 同一做法：用相对导入，调用方只认 `@/shared/shell`，
// 等发布名固定后把这一行换成包名即可，调用方不需要跟着改。
export * from '../../../packages/ui-canvas/src/shell.ts'
