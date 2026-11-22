# Mobile Observability dashboard — self-hostable image (local, VPS or fleet).
#
# Build from the repository root (the pnpm workspace includes packages/*):
#   docker build --target runner -t mobile-observability .
#
# Targets:
#   deps       workspace node_modules (with dev tools: tsx, drizzle-kit)
#   build      next build (standalone output for the dashboard)
#   migrations runtime able to apply Drizzle migrations (`docker compose run migrate`)
#   runner     minimal production image running the standalone Next.js server

# The lockfile pins corepack's pnpm version via the packageManager field.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/react-native/package.json packages/react-native/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/example/package.json apps/example/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY packages/protocol packages/protocol
COPY apps/dashboard apps/dashboard
# Build-time placeholders: all runtime configuration comes from environment
# variables at start (a single image serves local, VPS and enterprise targets).
ENV DATABASE_URL=postgres://build-time:placeholder@localhost:5432/placeholder \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000
RUN pnpm --filter @mobile-observability/dashboard build

FROM deps AS migrations
WORKDIR /app
COPY apps/dashboard/drizzle apps/dashboard/drizzle
COPY apps/dashboard/src/db apps/dashboard/src/db
COPY apps/dashboard/drizzle.config.ts apps/dashboard/tsconfig.json apps/dashboard/
ENTRYPOINT ["pnpm", "--filter", "@mobile-observability/dashboard", "exec", "tsx", "src/db/migrate.ts"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Standalone output: server.js plus only the traced dependencies.
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
