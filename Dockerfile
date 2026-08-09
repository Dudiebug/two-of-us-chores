FROM node:24-bookworm-slim

ENV NODE_ENV=production DATA_DIR=/data DATABASE_PATH=/data/chores.db BACKUP_DIR=/data/backups PORT=3000 COREPACK_HOME=/opt/corepack
WORKDIR /app

RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune
COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data "$COREPACK_HOME"
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
