# @zjarlin/nav-tree

任意层级的导航树：`buildForest` / `flatten` / `filterForest` 是纯函数，`NavTree.vue` 只渲染求解后的行。

- **扁平声明 → 森林**：插件各自注册 `{ id, parent?, group?, folder? }`，装配阶段拼成无限深度，父节点后注册也能挂上。
- **折叠是宿主的集合**：组件只发 `toggle`，展开状态由调用方持久化（侧栏插件记在本机）。
- **无业务符号**：不认路由、不认权限、不认菜单字段之外的东西，任何后台或文档导航都能用。

```ts
const forest = buildForest(items, { groupOrder: ['概览', '系统管理'], groupLabel: (g) => g.toUpperCase() })
const rows = flatten(forest, { expanded, activePath: route.path })
```
