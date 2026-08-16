import type { Request } from "express";
import { query } from "../db/client";

// Resolve the owning project id from an entity route param so that
// requireProjectMember can enforce tenant isolation + membership on
// entity-scoped routes (/cases/:id, /runs/:id, etc.).
export function projectFromCase() {
  return async (req: Request) => {
    const id = req.params.caseId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_cases WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromRun() {
  return async (req: Request) => {
    const id = req.params.runId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_runs WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromDefect() {
  return async (req: Request) => {
    const id = req.params.defectId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM defects WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromExecution() {
  return async (req: Request) => {
    const id = req.params.executionId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT r.project_id FROM test_executions e JOIN test_runs r ON r.id = e.run_id WHERE e.id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromSuite() {
  return async (req: Request) => {
    const id = req.params.suiteId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_suites WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromPlan() {
  return async (req: Request) => {
    const id = req.params.planId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM test_plans WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
export function projectFromRelease() {
  return async (req: Request) => {
    const id = req.params.releaseId ?? req.params.id;
    if (!id) return undefined;
    const r = await query("SELECT project_id FROM releases WHERE id = $1", [id]);
    return r.rows[0]?.project_id;
  };
}
