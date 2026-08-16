# ipmo

ipmo is a SaaS product. This is the product repository: a monorepo containing the API and web app, wired for CI from day one.

## Stack

- **Workspace**: pnpm workspaces monorepo
- **Language**: TypeScript (strict) across all packages
- **API**: [Hono](https://hono.dev) + `@hono/node-server` on Node, in `apps/api`
- **Database**: SQLite via Node's built-in `node:sqlite` (zero extra DB dependency)
- **Web**: [React](https://react.dev) + [Vite](https://vite.dev), in `apps/web`
- **Tests**: [Vitest](https://vitest.dev) colocated next to source (`*.test.ts`, `*.test.tsx`)
- **Lint**: ESLint flat config with `typescript-eslint`
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)

## Repo layout

```
apps/
  api/    Node + Hono HTTP API (auth + projects/tasks domain)
  web/    React + Vite web app
```

Each app is a self-contained npm package with its own `package.json`, `tsconfig.json`, and scripts. Root scripts run the corresponding command across all packages via `pnpm -r`.

## Getting started

Requires Node 22+ (for `node:sqlite`) and pnpm 9.

```bash
pnpm install
pnpm dev        # run all apps in watch mode
```

The API listens on `PORT` (default `3000`). Set `IPMO_DB_PATH` to choose the SQLite file location (defaults to `./data/ipmo.sqlite`; tests use `:memory:`).

## Commands

Run these from the repo root; they execute across every package.

| Command          | What it does                          |
| ---------------- | ------------------------------------- |
| `pnpm typecheck` | TypeScript check (no emit)            |
| `pnpm lint`      | ESLint                                |
| `pnpm test`      | Run all tests once                    |
| `pnpm build`     | Produce production builds             |

The CI pipeline runs **typecheck → lint → test → build** on every push to `main` and on every pull request. If it is green locally, it should be green in CI — the workflow runs the same four root commands.

## Conventions

- **Strict TypeScript** everywhere; no `any` unless a deliberate, documented escape hatch.
- **Tests colocated** with the code they cover; name files `<subject>.test.ts(x)`.
- **Prefer the smallest verification**: run `pnpm test` scoped to a package (`pnpm --filter @ipmo/api test`) while iterating; run the full pipeline before shipping.
- **Package naming**: internal packages use the `@ipmo/` scope.
- **Configuration lives at the repo root** (workspace, TS base, ESLint); per-app config is kept minimal and extends the base.
- **No secrets in the repo.** Environment-specific values go in `.env` (gitignored) and are injected via the deploy path.

## MVP core flows

The first user-facing slices are auth/account basics and the primary domain (projects & tasks).

- **Auth** (`/api/auth/*`): signup, login, logout, and `/me`. Passwords are hashed with `scrypt` (salted, constant-time compare). Sessions are opaque tokens stored in SQLite, delivered as an `HttpOnly; SameSite=Lax` cookie (`ipmo_session`).
- **Projects** (`/api/projects`): list, create, read (with tasks), rename, delete — every project is scoped to its owning user.
- **Tasks** (`/api/tasks`): create on a project, update title/status, delete. Statuses: `todo`, `in_progress`, `done`. All access is owner-scoped (cross-user access returns `404`).

The web app (`apps/web`) is wired to the API through the Vite dev proxy and covers the whole loop: sign up / sign in → create a project → add tasks → mark them done. API auth and domain flows are covered by colocated Vitest suites (19 tests) that exercise the routes with an in-memory SQLite database.

## Deploy

ipmo ships as a **single deployable unit**: the Hono API also serves the built
web app from `apps/web/dist`, so a preview and a production deploy are
identical. When `apps/web/dist` exists, `apps/api/src/server.ts` serves `/`
(index.html, SPA) and the API (`/api`, `/health`) from one process.

- **Preview** (`.github/workflows/preview.yml`): builds on every PR and
  publishes `PREVIEW_BASE_URL/preview-<PR number>/`, then comments the URL.
- **Production** (`.github/workflows/deploy.yml`): builds on every push to
  `main` and deploys to `PRODUCTION_BASE_URL`.
- **Container**: `Dockerfile` builds the single-process image (Node 24 + pnpm,
  API + web on port `3000`, SQLite at `/data`).

Local equivalents: `scripts/package-preview.sh`, `scripts/publish-preview.sh`,
`scripts/deploy-production.sh`. Full details (secrets, host layout, run
commands) in [`DEPLOYMENT.md`](DEPLOYMENT.md).