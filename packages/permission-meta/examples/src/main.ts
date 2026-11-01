import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
// 运行期指令：编译期已经把 metaId 写进指令参数，这里只提供「当前用户授权列表」。
import { installPermissionMeta } from '@addzero/permission-meta/runtime'

// 演示用授权：查询区的列表行放行，管理员区块故意不放行，用来观察被移除的节点。
const GRANTED = [
  'page:src/App.vue:0', // 查询区域（按文档序兜底 id）
  'biz:src/components/BizAddBtn.vue', // 业务组件（按组件文件兜底 id）
  'status_tag', // 显式 id
  'biz_filter_area', // 显式 id
]

createApp(App)
  .use(ElementPlus)
  .use({
    install(app) {
      installPermissionMeta(app, { granted: () => GRANTED })
    },
  })
  .mount('#app')
