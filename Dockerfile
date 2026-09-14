# =========================================================================
# paymyloan-back — backend/API de PayMyLoan.ai
#
# node:22-slim (Debian, glibc): Prisma requiere un motor nativo con OpenSSL,
# así que ya no alcanza node:22-alpine (musl) — mismo criterio que usa el
# proyecto Owner.
#
# Build multietapa con salida "standalone": la imagen de runtime solo lleva
# el server compilado y las dependencias que usa, no node_modules completo.
# =========================================================================
FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder: "prisma generate" valida que DATABASE_URL exista al momento
# del build (no que sea alcanzable). docker-compose siempre la sobreescribe
# con la conexión real en runtime.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Corepack (incluido en Node 22) instala y fija la versión exacta de pnpm
# declarada en package.json ("packageManager"), igual en las 4 stages.
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# ---------- dependencias ----------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---------- desarrollo (hot reload) ----------
# Se usa con docker-compose.dev.yml. El codigo se monta como volumen.
FROM base AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["pnpm", "run", "dev", "-H", "0.0.0.0", "-p", "4000"]

# ---------- build de produccion ----------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# ---------- runtime ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# No corre como root.
RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Red de seguridad además de outputFileTracingIncludes (ver next.config.ts):
# el motor nativo de Prisma no siempre queda en el tracing de "standalone".
# Con pnpm, el cliente generado vive dentro del store aislado
# (node_modules/.pnpm/@prisma+client@.../node_modules/.prisma), no en
# node_modules/.prisma como con npm.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
