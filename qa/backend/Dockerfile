# ---- Build stage ----
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies (with dev deps so `tsc` is available)
COPY package.json package-lock.json* ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY schema.sql ./
COPY migrations ./migrations

# Non-root user
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/storage/uploads \
  && chown -R app:app /app
USER app

EXPOSE 4000

CMD ["node", "dist/server.js"]
