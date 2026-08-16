# QA — Quality Assurance & Test Intelligence platform

A multi-tenant QA platform for authoring versioned test cases, tracing them to
requirements, executing them manually or ingesting automated CI results, triaging
defects, detecting flaky tests, and gating releases with a deterministic,
auditable **Quality Gate**.

## Stack

- **Frontend**: React + TypeScript + Vite, served by nginx (proxies `/api`).
- **Backend**: Node + TypeScript + Express + PostgreSQL 16.
- **Infra**: Docker Compose (`db`, `backend`, `frontend`).

## Quick start

```bash
cp .env.example .env          # optional — defaults are sane
docker compose up -d --build
```

On first boot the backend:

1. Waits for Postgres to accept connections (retries ~80s).
2. Runs migrations (`schema.sql` + `migrations/*.sql`, idempotent).
3. Seeds a demo org + owner from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (both passed
   through `docker-compose.yml`), plus a full demo dataset.

- App: http://localhost:8080
- API: http://localhost:4000/api

## Verify

```bash
curl http://localhost:4000/api/health
# → {"status":"ok","db":"up","version":"1.0.0","uptimeSeconds":…}

curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@qa.local","password":"admin-password"}'
# → 200 { "accessToken": …, "refreshToken": …, "user": … }
```

## Demo accounts (seeded)

| Role      | Email             | Password           |
| --------- | ----------------- | ------------------ |
| owner     | `admin@qa.local`  | `admin-password`   |
| qa_lead   | `lead@qa.local`   | `lead-password`    |
| tester    | `tester1@qa.local`| `tester-password`  |
| tester    | `tester2@qa.local`| `tester-password`  |
| developer | `dev@qa.local`    | `dev-password`     |
| viewer    | `viewer@qa.local` | `viewer-password`  |

## Tests

The backend test suite runs **unit tests** (pure logic) and **integration tests**
(over the real HTTP layer, backed by an in-process Postgres via PGlite — no
Docker required).

```bash
cd backend
npm install
npm test                # unit + integration
npm run typecheck       # tsc --noEmit
```

Unit coverage: failure-signature normalization, flake math (incl. same-commit
transition rule), risk scoring, gate criteria (each operator, pass/fail/waived),
JUnit/xUnit/TRX/Allure parsers against real fixture files.

Integration coverage: the §10 acceptance happy path, version immutability,
defect state machine (incl. self-verification), tenant isolation (org A → org B
404), and the RBAC matrix.

## CI pipeline

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to
`main`/`master` and on every pull request. It has two jobs:

- **Backend** — spins up a `postgres:16-alpine` service container, installs
  deps, type-checks, runs the full unit + integration suite (`npm test`), then
  runs `npm run test:db-smoke` which applies migrations + seeds + login against
  the **containerized** Postgres (exercising the `citext` path PGlite skips).
- **Frontend** — installs deps, runs `npm test`, and builds (`npm run build`)
  as a smoke gate.

CI configuration comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`JWT_SECRET` (repo
variables/secrets with local-dev defaults — see `.env.example`). `DATABASE_URL`
in the backend job points at the service container.

### Equivalent local check (no git remote yet)

Until a remote is provisioned, a maintainer reproduces the green check with:

```bash
# backend: unit + integration + typecheck + containerized-DB smoke
cd backend
npm ci
npm run typecheck
npm test

# the smoke test needs a real Postgres 16 on :5432 — easiest via compose:
docker compose up -d db
DATABASE_URL="postgres://qa:qa_dev_password@localhost:5432/qa" npm run test:db-smoke

# frontend: tests + build
cd ../frontend
npm ci
npm test
npm run build
```

## Acceptance script (§10)

The build is done when the following passes against a real `docker compose up`
stack. Steps 1–19 are also encoded in `backend/test/integration/acceptance.test.ts`.

```bash
# 1. healthy stack
docker compose up -d --build
curl http://localhost:4000/api/health          # {"status":"ok","db":"up"}

# 2. login
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@qa.local","password":"admin-password"}' | jq -r .accessToken)
AUTH="Authorization: Bearer $TOKEN"

# 3. create project
PID=$(curl -s -X POST http://localhost:4000/api/projects -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"key":"WEB","name":"Web App"}' | jq -r .id)

# 4. requirements
curl -s -X POST http://localhost:4000/api/projects/$PID/requirements -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"ref":"REQ-001","title":"Login"}' 
curl -s -X POST http://localhost:4000/api/projects/$PID/requirements -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"ref":"REQ-002","title":"Checkout"}'

# 5. cases … 6. version immutability … 7–19 — see the integration test above,
#    or run: cd backend && npm test
```

## Structure

```
backend/
  schema.sql          canonical DDL (every column the code reads)
  migrations/         incremental, idempotent SQL applied in order
  src/
    db/               pool, migrations runner, seeder (retries ~80s)
    middleware/       auth (RBAC), rate-limit, error handler, request id
    intelligence/     failure signature, flake math, risk, gate
    parsers/          junit, xunit, trx, allure_json
    services/         domain logic + state machines
    routes/           §7 API surface
  test/               unit + integration suites and report fixtures
  Dockerfile
frontend/             React + TypeScript SPA (built by the frontend workstream)
docker-compose.yml
.env.example
```

## Configuration

All values have sane defaults (see `.env.example`). Key variables:

| Variable           | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `DATABASE_URL`     | Postgres connection string                |
| `JWT_SECRET`       | JWT signing secret                        |
| `ADMIN_EMAIL`      | Seeded owner email (passed to the backend)|
| `ADMIN_PASSWORD`   | Seeded owner password (passed to backend) |
| `PORT`             | Backend HTTP port (default `4000`)        |

## API summary

All under `/api`, JSON, JWT bearer (except `/auth/*` and `/health`). Ingest uses
an `X-API-Key` header. Uniform errors: `{ error, message, details? }`.
See the QA Prompt §7 for the full surface.
