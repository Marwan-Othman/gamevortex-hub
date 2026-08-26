FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
# package-lock.json is intentionally not required by this source bundle; all direct versions are pinned.
RUN npm install --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY . .
RUN npx prisma generate
RUN npm run typecheck
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
