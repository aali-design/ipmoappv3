import type { Request } from "express";
import { query } from "../db/client";
import { err } from "../util/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every entity id route param is a Postgres `uuid`. Passing a non-uuid string
// ("undefined", "new", …) to a `WHERE id = $1` query makes Postgres throw
// `invalid input syntax for type uuid`, which surfaces as an opaque 500.
// Reject malformed ids up front with a clean 404 instead.
function entityId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (!UUID_RE.test(id)) throw err.notFound("Resource not found");
  return id;
}

// Resolve the owning project id from an entity route param so that
// requireProjectMember can enforce tenant isolation + membership on
// entity-scoped routes (/cases/:id, /runs/:id, etc.).
export function projectFromCase() {
  return async (req: Request) => {
    const id = entityId(req.params.caseId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_cases WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromRun() {
  return async (req: Request) => {
    const id = entityId(req.params.runId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_runs WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromDefect() {
  return async (req: Request) => {
    const id = entityId(req.params.defectId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM defects WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromExecution() {
  return async (req: Request) => {
    const id = entityId(req.params.executionId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT r.project_id FROM test_executions e JOIN test_runs r ON r.id = e.run_id WHERE e.id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromSuite() {
  return async (req: Request) => {
    const id = entityId(req.params.suiteId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_suites WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromPlan() {
  return async (req: Request) => {
    const id = entityId(req.params.planId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_plans WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromRelease() {
  return async (req: Request) => {
    const id = entityId(req.params.releaseId ?? req.params.id);
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM releases WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
