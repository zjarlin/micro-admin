// 浏览器元素拾取 → 源码位置：编译期标记 + 运行期拾取。
//
// 三层各管一件事，互不耦合：
// - `vite`：构建期把 `data-source-loc` 写进模板元素，并注入本地 `.vue` 清单；
// - `location`：DOM ↔ 源位置 / 组件链的纯函数，无框架依赖；
// - `browser`：Chrome 式拾取器（Shadow DOM 覆盖层 + 快捷键），零业务符号。
export { SOURCE_ATTRIBUTE, parseLocation, formatLocation, locateElement, normalizeFile, componentChain, createFileResolver, filesNamed, instanceProps } from './location.ts'
export type { ComponentFrame, SourceLocation, PickedElement, ChainOptions, FileResolver } from './location.ts'
export { markSourceElements, sourceLocatorPlugin, SOURCE_LOCATOR_ATTRIBUTE, SOURCE_LOCATOR_MANIFEST_ID } from './vite.ts'
export type { SourceLocatorOptions } from './vite.ts'
export { createSourcePicker, readManifest, describePath, repoUrl } from './browser.ts'
export type { SourcePicker, SourcePickerOptions, PickedDetail, PickerLabels, PageOrigin } from './browser.ts'
