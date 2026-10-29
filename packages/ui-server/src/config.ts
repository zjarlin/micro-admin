// 服务端配置：唯一默认值来源，全部可用环境变量覆盖。
//
// 缺省值只在这里出现一次；宿主不要在自己的代码里再写一遍端口或目录。
import { z } from 'zod'

const schema = z.object({
  /** 监听端口。 */
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(5181),
  /** 监听地址，默认只对回环开放，由反向代理对外。 */
  SERVER_HOST: z.string().default('127.0.0.1'),
  /** SQLite 落盘路径；`:memory:` 表示内存库（测试/预览）。 */
  DB_FILE: z.string().default('.data/ui.db'),
  /** 兼容旧变量：只给目录时拼上 ui.db。 */
  DATA_DIR: z.string().optional(),
  /** 前端构建产物目录；存在时由本服务一并托管。 */
  STATIC_DIR: z.string().default('dist'),
  /** 允许跨域的来源，逗号分隔；为空表示同源部署、不开启 CORS。 */
  CORS_ORIGINS: z.string().default(''),
  /** 页面配置写权限码，宿主可覆盖成自己体系的权限名。 */
  SCHEMA_WRITE_PERMISSION: z.string().default('system:page:config'),
})

export type ServerConfig = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig & { DB_PATH: string } {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`服务端配置不合法：${detail}`)
  }
  const config = parsed.data
  // DATA_DIR 是给「只想指定目录」的宿主用的糖；显式 DB_FILE 永远优先。
  const dbPath = env.DB_FILE
    ? config.DB_FILE
    : (config.DATA_DIR ? `${config.DATA_DIR.replace(/\/$/, '')}/ui.db` : config.DB_FILE)
  return { ...config, DB_PATH: dbPath }
}

export function corsOrigins(config: Pick<ServerConfig, 'CORS_ORIGINS'>): string[] {
  return config.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean)
}
