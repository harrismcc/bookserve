# syntax=docker/dockerfile:1

# Build stage. Runs on the target platform, so better-sqlite3's native addon is
# installed (prebuilt binary, or compiled with the toolchain below) for that arch.
FROM node:22-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime stage: the self-contained Nitro output plus the migrations applied on boot.
FROM node:22-slim
ENV NODE_ENV=production \
  PORT=3000 \
  BOOKSERVE_DATA_DIR=/config \
  BOOKSERVE_LIBRARY_DIR=/books
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
VOLUME ["/config", "/books"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
