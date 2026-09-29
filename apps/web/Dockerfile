FROM oven/bun:1.2.18 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile

FROM oven/bun:1.2.18 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ARG FREESOUND_CLIENT_ID=
ARG FREESOUND_API_KEY=
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SITE_URL=http://localhost:3100
ENV FREESOUND_CLIENT_ID=$FREESOUND_CLIENT_ID
ENV FREESOUND_API_KEY=$FREESOUND_API_KEY
RUN bun run build:web

FROM oven/bun:1.2.18 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
