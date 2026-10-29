// Element Plus 版 Notifier：共享层只声明接口，这里落到具体组件。
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Notifier } from '@addzero/data-page'

export const elementNotifier: Notifier = {
  async confirm(message, title) {
    try {
      await ElMessageBox.confirm(message, title, {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      })
      return true
    } catch {
      return false
    }
  },
  success(message) {
    ElMessage.success(message)
  },
  error(message) {
    ElMessage.error(message)
  },
  info(message) {
    ElMessage.info(message)
  },
}
