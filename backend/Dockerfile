# SCHOLARION backend — Node + TypeScript (Express)
FROM node:22-alpine AS build
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace manifests and install all workspace deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile

# Copy backend source and build
COPY backend ./backend
RUN pnpm --filter @scholarion/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
RUN pnpm install --frozen-lockfile --prod --filter @scholarion/backend

COPY --from=build /app/backend/dist ./backend/dist
COPY db ./db

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/server.js"]
