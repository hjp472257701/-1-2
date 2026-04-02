# 单容器：构建前端 + 运行 Node API，SQLite 挂载到 /data
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
COPY --from=web-builder /app/web/dist ./web/dist
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/data.sqlite3
EXPOSE 3001
VOLUME ["/data"]
CMD ["node", "server/index.js"]
