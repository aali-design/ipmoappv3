# Deployment

ipmo ships as a single deployable unit: the Hono API also serves the built web
app (see `apps/api/src/server.ts`). This keeps a preview and a production
deploy identical.

## Pipeline

- **CI** (`.github/workflows/ci.yml`): runs on every push/PR — install, typecheck, lint, test, build.
- **Preview** (`.github/workflows/preview.yml`): on every PR — builds and publishes a preview to
  `PREVIEW_BASE_URL/preview-<PR number>/`, then comments the URL on the PR.
- **Production** (`.github/workflows/deploy.yml`): on every push to `main` — builds, packages, and
  deploys to `PRODUCTION_BASE_URL`, then restarts the ipmo service.

## Secrets required (repo Settings → Secrets and variables → Actions)

| Secret                 | Used by       | Purpose                                   |
| ---------------------- | ------------- | ----------------------------------------- |
| `PREVIEW_HOST`         | preview.yml   | SSH host for preview static + API serving |
| `PREVIEW_HOST_USER`    | preview.yml   | SSH user                                  |
| `PREVIEW_HOST_PORT`    | preview.yml   | SSH port (optional, default 22)           |
| `PREVIEW_HOST_KEY`     | preview.yml   | SSH private key                           |
| `PREVIEW_BASE_URL`     | preview.yml   | Public base URL previews are served from  |
| `PRODUCTION_HOST`      | deploy.yml    | SSH host for production                   |
| `PRODUCTION_HOST_USER` | deploy.yml    | SSH user                                  |
| `PRODUCTION_HOST_PORT` | deploy.yml    | SSH port (optional, default 22)           |
| `PRODUCTION_HOST_KEY`  | deploy.yml    | SSH private key                           |
| `PRODUCTION_BASE_URL`  | deploy.yml    | Public production URL                     |

If no `PREVIEW_BASE_URL` is configured the preview workflow still builds and
packages, but only reports that no public URL was published.

## Local commands

```bash
pnpm build                        # typecheck + build all apps (web → apps/web/dist)
scripts/package-preview.sh        # assemble .release/app
scripts/publish-preview.sh        # push a preview to the preview host
scripts/deploy-production.sh      # push + restart production
```

A release directory is self-contained:

```bash
cd .release/app
pnpm install --prod --frozen-lockfile
pnpm --filter @ipmo/api start     # listens on PORT (default 3000), serves API + web
```

## Container deploy

A `Dockerfile` builds the same single-process image (Node 24 + pnpm, API + web
on port `3000`, SQLite persisted at `/data`). Build and run:

```bash
docker build -t ipmo .
docker run -d -p 3000:3000 -v ipmo-data:/data ipmo
```

## Host layout expectations

The SSH deploy scripts install the release to `~/app/current` (production) or
`~/previews/<slug>/app` (preview) and rely on the host running the app with
`pnpm --filter @ipmo/api start` behind its reverse proxy (which must route
`/` to the app's port and `/api`, `/health` to the same port). Production
restart uses `systemctl --user restart ipmo`, falling back to `pm2 restart
ipmo`; the host should set that up once.