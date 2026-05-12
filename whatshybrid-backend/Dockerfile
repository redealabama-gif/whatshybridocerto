# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:26-alpine AS deps

WORKDIR /app

# Instalar dependências nativas para better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev

COPY package*.json ./
RUN npm ci --only=production

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:26-alpine AS production

WORKDIR /app

# Ferramentas mínimas para better-sqlite3 em runtime
RUN apk add --no-cache sqlite-libs tini

# Copiar dependências compiladas
COPY --from=deps /app/node_modules ./node_modules

# Copiar código-fonte
COPY . .

# Criar diretórios necessários
RUN mkdir -p data logs && \
    chown -R node:node /app

USER node

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Usar tini como PID 1 para signal handling correto (SIGTERM/SIGINT)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
