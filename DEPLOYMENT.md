# Deployment

ipmo ships as a single deployable unit: the Hono API also serves the built web
app (see `apps/api/src/server.ts`). A single Docker image (`Dockerfile`) runs
the whole app on port `3000`, with SQLite persisted at `/data`.

Deployment happens on the **ipmo host** through `ipmo-publish` — the same
mechanism every project on this instance uses. There is no per-project SSH
"server setup"; the helper builds and runs the stack and returns a real URL.

## What the host needs from the repo

Two files at the repo root:

1. **`docker-compose.yml`** — the full stack. Here it's a single `web` service
   built from the root `Dockerfile`, with a named volume for SQLite.
2. **`ipmo-app.json`** — the one web service to expose and its container port:

   ```json
   { "service": "web", "port": 3000 }
   ```

## Pipeline

- **CI** (`.github/workflows/ci.yml`): runs on every push/PR — install, typecheck, lint, test, build.
- **Preview** (`.github/workflows/preview.yml`): on every PR — builds and packages a preview.
- **Production** (`.github/workflows/deploy.yml`): on every push to `main` — typecheck, test,
  build, then `scripts/deploy-production.sh` tars the repo, uploads it to the host, and runs
  `sudo /usr/local/bin/ipmo-publish deploy`, which prints `PUBLISHED: https://{slug}.ipmo.app`.

## How a deploy runs

`scripts/deploy-production.sh`:

1. Tars the repo (excluding `node_modules`, `.git`, `.github`).
2. Uploads the bundle to `/srv/ipmo-deploy/incoming/<slug>.tgz` on the host.
3. Runs `sudo /usr/local/bin/ipmo-publish deploy <bundle> <slug>`.

The helper allocates a loopback port (`41000`–`41999`), starts the stack as
compose project `ipmoapp_<slug>`, registers DNS + tunnel ingress, and prints the
URL. `APP_SLUG` (a repo **variable**) pins a stable hostname; omit it and each
deploy mints a new one.

## Secrets / variables required (repo Settings)

| Name                   | Kind     | Used by      | Purpose                                    |
| ---------------------- | -------- | ------------ | ------------------------------------------ |
| `PRODUCTION_HOST`      | secret   | deploy.yml   | SSH host for the ipmo deploy target        |
| `PRODUCTION_HOST_USER` | secret   | deploy.yml   | SSH user (the `ipmodeploy` account)        |
| `PRODUCTION_HOST_PORT` | secret   | deploy.yml   | SSH port (optional, default 22)            |
| `PRODUCTION_HOST_KEY`  | secret   | deploy.yml   | SSH private key for the deploy user        |
| `APP_SLUG`             | variable | deploy.yml   | Stable 12-char `[a-z0-9]` production slug  |

## Verifying a deploy

Do not trust a green workflow alone — confirm all three:

1. `ipmo-publish` printed `PUBLISHED: https://<slug>.ipmo.app`
2. `curl -fsS https://<slug>.ipmo.app/` returns 2xx
3. `curl -fsS https://<slug>.ipmo.app/health` returns `{"ok":true}`

A 502 shortly after deploy is normal (DNS is registered before the image
build); it clears once the container starts.

## Local commands

```bash
pnpm build                        # typecheck + build all apps (web → apps/web/dist)
docker compose config --quiet     # validate the stack
docker compose up -d --build      # run locally (if Docker is available)
```

The image is self-contained; see `Dockerfile` for the exact runtime
(`pnpm --filter @ipmo/api start`, `PORT=3000`, `IPMO_DB_PATH=/data/ipmo.sqlite`).

## Cleanup

```sh
sudo /usr/local/bin/ipmo-publish remove <slug>   # containers, volumes, DNS, ingress
sudo /usr/local/bin/ipmo-publish list            # what is currently published
```
