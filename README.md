# SCHOLARION

Multi-tenant school management and student information system (SIS). One school (tenant) runs its academic year end to end: enrol students into sections, build a conflict-free timetable, take per-period attendance, assess and grade with a configurable weighting engine, publish immutable report cards, and run the full fee cycle.

## Stack

- **Backend**: Node + TypeScript (Express), PostgreSQL 16
- **Frontend**: React + TypeScript + Vite (nginx-served SPA)
- **Orchestration**: Docker Compose (`db`, `backend`, `frontend`)

## Quick start

```bash
cp .env.example .env
docker compose up -d
```

On first boot the backend runs migrations and seeds the demo school **Scholarion Academy** with an admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (defaults documented in `.env.example`).

- Web UI: http://localhost:8080
- API health: http://localhost:3000/api/health

## Layout

- `db/schema.sql` — full domain schema (every column the code reads)
- `db/migrations/` — ordered, idempotent SQL migrations run before serving traffic
- `backend/` — Express API: auth, RBAC/tenancy, timetable/attendance/grading/fees engines
- `frontend/` — React portals for admin/registrar, teacher, student, guardian
- `scripts/` — seed + verification helpers

## Verification

```bash
# unit + integration tests (backend)
cd backend && npm test

# acceptance script (spec §11) is driven from the running stack:
curl http://localhost:3000/api/health
```