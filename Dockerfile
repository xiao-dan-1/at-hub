ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV AT_INSPECTOR_HOST=0.0.0.0
ENV AT_INSPECTOR_PORT=5173

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server

USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "const port=process.env.AT_INSPECTOR_PORT||5173; fetch('http://127.0.0.1:'+port+'/subscription').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/local-server.mjs"]
