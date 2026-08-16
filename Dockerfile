# ipmo production image: API + built web app served by one Node process.
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/tsconfig.json apps/api/tsconfig.json
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
RUN pnpm install --prod --frozen-lockfile
ENV PORT=3000
ENV IPMO_DB_PATH=/data/ipmo.sqlite
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "--filter", "@ipmo/api", "start"]