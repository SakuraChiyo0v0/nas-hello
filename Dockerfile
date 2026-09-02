# 零依赖 Node 服务，验证 push -> build -> NAS 自动更新的链路
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./

ARG APP_VERSION=dev
ARG APP_COMMIT=local
ENV APP_VERSION=${APP_VERSION}
ENV APP_COMMIT=${APP_COMMIT}
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.mjs"]
