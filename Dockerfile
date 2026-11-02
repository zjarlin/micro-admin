# 微内核后台（micro-admin）：构建前端产物 + 内聚 TS 后端，单容器同源发布。
#
# 两个阶段：
# 1) build：装全量依赖，出 packages 的 dist（对外可 install），再 vue-tsc + vite build；
# 2) runtime：只装生产依赖，带 server/ 与 src/ 由 Node 22 直接执行 TS，同时托管 dist/ 静态产物。
#
# 数据目录由宿主 bind mount 到 /app/.data（compose 里用 *_DATA_DIR 注入），镜像本身无持久化状态。
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm i -g pnpm@11.7.0
# 依赖层单独缓存：只要锁文件不变就不重复解析。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/data-page/package.json packages/data-page/
COPY packages/data-page-element/package.json packages/data-page-element/
COPY packages/ui-canvas/package.json packages/ui-canvas/
COPY packages/ui-server/package.json packages/ui-server/
COPY packages/ifc-canvas/package.json packages/ifc-canvas/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:packages && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN npm i -g pnpm@11.7.0
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages packages
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
# 前端产物 + 后端源码（Node 22 原生执行 TS，无需再构建）。
COPY --from=build /app/dist dist
COPY --from=build /app/server server
# 后端直接跑 TS 源码：server/ 与 src/schema 会 import src/plugins/*/{data,seed}.ts，
# 所以整份 src/ 都要带上（缺一个插件目录就会 ERR_MODULE_NOT_FOUND 崩溃）。
COPY --from=build /app/src src
# 只对外暴露容器内端口；宿主映射由 compose 决定，默认只绑回环。
ENV SERVER_HOST=0.0.0.0 SERVER_PORT=5181 DB_FILE=/app/.data/ui.db STATIC_DIR=/app/dist
EXPOSE 5181
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||5181)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.ts"]
