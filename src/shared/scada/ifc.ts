// 3D/IFC 能力的统一入口。
//
// 实现在 workspace 包 `packages/ifc-canvas`（可独立发布）；这里用相对导入而不是包名，
// 是因为包名正在与 `@zjarlin/*` 收敛，等发布名固定后把这一行换成包名即可，
// 其余代码只认 `@/shared/scada/ifc`，不需要跟着改。
export * from '../../../packages/ifc-canvas/src/index.ts'
