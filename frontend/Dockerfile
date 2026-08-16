# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-alpine AS build
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Install workspace dependencies first (cache-friendly layer).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the SPA (Vite outputs to dist/).
COPY frontend frontend
RUN pnpm --filter @scholarion/frontend build

# ---------- Runtime stage ----------
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
