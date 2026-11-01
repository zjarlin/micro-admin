// CAD（DXF）导入能力的统一入口。
//
// 实现在 workspace 包 `packages/cad-import`（可独立发布）；这里用相对导入而不是包名，
// 与 `ifc.ts` 同一个理由：包名正在与 `@addzero/*` 收敛，等发布名固定后换一行即可，
// 其余代码只认 `@/shared/scada/cad`，不需要跟着改。
export * from '../../../packages/cad-import/src/index.ts'
