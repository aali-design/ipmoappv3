import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import { projectFromRun, projectFromExecution } from "./helpers";
import { query } from "../db/client";
import * as runService from "../services/runService";
import { dispatchWebhook } from "../services/webhookService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const PLAN = ["owner", "qa_lead"] as const;
const EXECUTE = ["owner", "qa_lead", "tester"] as const;

async function loadRun(projectId: string, runId: string) {
  const res = await query(
    `SELECT r.*, p.organization_id FROM test_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = $1 AND r.project_id = $2`,
    [runId, projectId],
  );
  return res.rows[0];
}

r.post("/projects/:projectId/runs", requireProjectMember(), requireRole(PLAN), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      name: z.string().optional(),
      suiteId: z.string().uuid().nullish(),
      caseIds: z.array(z.string().uuid()).optional(),
      filter: z.record(z.unknown()).optional(),
      planId: z.string().uuid().nullish(),
      buildId: z.string().uuid().nullish(),
      environmentId: z.string().uuid(),
      source: z.enum(["manual", "ci"]).optional(),
    }),
    req.body,
  );
  const run = await runService.createRun({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    ...body,
    createdBy: req.user.id,
  });
  res.status(201).json(run);
}));

r.get("/projects/:projectId/runs", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  const q = parse(
    z.object({ status: z.string().optional(), source: z.string().optional(), buildId: z.string().uuid().optional(), suiteId: z.string().uuid().optional() }),
    req.query,
  );
  res.json(await runService.listRuns(req.params.projectId, q));
}));

r.get("/runs/:id", requireProjectMember(projectFromRun()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await runService.getRun(req.project!.id, req.params.id));
}));

function transition(to: "in_progress" | "paused" | "completed" | "aborted") {
  return asyncHandler(async (req: AuthedRequest, res) => {
    const run = await loadRun(req.project!.id, req.params.id);
    if (!run) return res.status(404).json({ error: "NotFound", message: "Run not found" });
    const body = parse(z.object({ force: z.boolean().optional(), reason: z.string().optional() }), req.body);
    await runService.transitionRun(
      { id: run.id, project_id: run.project_id, organization_id: run.organization_id, status: run.status },
      to,
      { actorId: req.user.id, ip: req.ip, force: body.force, reason: body.reason },
    );
    if (to === "completed" || to === "aborted") {
      await dispatchWebhook("run.completed", { runId: run.id, projectId: run.project_id, status: to }, run.organization_id);
    }
    res.json(await runService.getRun(req.project!.id, req.params.id));
  });
}

r.post("/runs/:id/start", requireProjectMember(projectFromRun()), requireRole(EXECUTE), transition("in_progress"));
r.post("/runs/:id/pause", requireProjectMember(projectFromRun()), requireRole(EXECUTE), transition("paused"));
r.post("/runs/:id/resume", requireProjectMember(projectFromRun()), requireRole(EXECUTE), transition("in_progress"));
r.post("/runs/:id/complete", requireProjectMember(projectFromRun()), requireRole(EXECUTE), transition("completed"));
r.post("/runs/:id/abort", requireProjectMember(projectFromRun()), requireRole(EXECUTE), transition("aborted"));

r.get("/runs/:id/executions", requireProjectMember(projectFromRun()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await runService.getExecutions(req.project!.id, req.params.id));
}));

r.post("/runs/:id/assign", requireProjectMember(projectFromRun()), requireRole(PLAN), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ assignments: z.array(z.object({ executionId: z.string().uuid().optional(), caseId: z.string().uuid().optional(), userId: z.string().uuid() })).min(1) }),
    req.body,
  );
  res.json(await runService.assignRun({ projectId: req.project!.id, runId: req.params.id, assignments: body.assignments }));
}));

// ---------- executions ----------
r.patch("/executions/:id", requireProjectMember(projectFromExecution()), requireRole(EXECUTE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      status: z.enum(["untested", "passed", "failed", "blocked", "skipped", "retest"]).optional(),
      comment: z.string().nullish(),
      stepResults: z.unknown().optional(),
      durationMs: z.number().int().nonnegative().nullish(),
    }),
    req.body,
  );
  res.json(await runService.patchExecution({
    projectId: req.project!.id,
    executionId: req.params.id,
    status: body.status,
    comment: body.comment ?? undefined,
    stepResults: body.stepResults,
    durationMs: body.durationMs ?? undefined,
    actorId: req.user.id,
    organizationId: req.user.organizationId,
    ip: req.ip,
  }));
}));

r.post("/executions/:id/retest", requireProjectMember(projectFromExecution()), requireRole(EXECUTE), asyncHandler(async (req: AuthedRequest, res) => {
  const result = await runService.retestExecution({ projectId: req.project!.id, executionId: req.params.id, actorId: req.user.id });
  res.status(201).json(result);
}));

export default r;
