// 服务端配置：唯一默认值来源，全部可用环境变量覆盖。
//
// 缺省值只在这里出现一次；其他文件一律读 `config`，不再各自 `?? 5181`。
import { z } from 'zod'

const schema = z.object({
  /** 监听端口。 */
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(5181),
  /** 监听地址，默认只对回环开放，由反向代理对外。 */
  SERVER_HOST: z.string().default('127.0.0.1'),
  /** 数据目录：页面资源与运行期数据的落盘位置（bind mount 目标）。 */
  DATA_DIR: z.string().default('.data'),
  /** 允许跨域的来源，逗号分隔；为空表示同源部署、不开启 CORS。 */
  CORS_ORIGINS: z.string().default(''),
  /** 前端构建产物目录；存在时由本服务一并托管。 */
  STATIC_DIR: z.string().default('dist'),
})

export type ServerConfig = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`服务端配置不合法：${detail}`)
  }
  return parsed.data
}

export function corsOrigins(config: ServerConfig): string[] {
  return config.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean)
}
