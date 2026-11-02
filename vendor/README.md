# vendor/

`@addzero/permission-meta` 的**预编译产物**（`pnpm pack` 出的 tgz）。

- 源码唯一来源：`iot-platform/studio/packages/permission-meta`（GitLab 私有仓库的 submodule）。
- 这里只放打包好的 tgz，方便 `docker build` 在不接触私有 Git、不需要凭证的前提下安装；
  不要在 `packages/` 下再放一份源码。
- 升级流程：在 studio 里改完源码 → 该包目录 `pnpm pack` → 把新的 `addzero-permission-meta-<version>.tgz`
  覆盖到这里 → 更新 `package.json` 里的文件名 → `pnpm install` → 确认 `meta-tree.json` 与产物。

为什么不用 git 依赖：仓库目前只在内部 GitLab 上线开发，未稳定前不推 GitHub；
npm 上也没有该包。tgz 是唯一不引入第二份源码、又不暴露内网的接法。
