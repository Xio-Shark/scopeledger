# ScopeLedger: Next.js standalone server with the PayPal agent toolkit.
# Build: docker buildx build --platform linux/amd64 [--build-arg SCOPELEDGER_BASE_PATH=/scopeledger] -t scopeledger:<tag> .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
ARG SCOPELEDGER_BASE_PATH=""
ENV SCOPELEDGER_BASE_PATH=$SCOPELEDGER_BASE_PATH
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ARG SCOPELEDGER_BASE_PATH=""
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 SCOPELEDGER_BASE_PATH=$SCOPELEDGER_BASE_PATH \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.SCOPELEDGER_BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
