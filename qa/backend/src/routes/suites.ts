import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import { projectFromSuite, projectFromPlan } from "./helpers";
import * as suiteService from "../services/suiteService";
import * as planService from "../services/planService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const WRITE = ["owner", "qa_lead", "tester"] as const;

// ---------- suites ----------
r.get("/projects/:projectId/suites", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await suiteService.listSuites(req.params.projectId));
}));

r.post("/projects/:projectId/suites", requireProjectMember(), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ name: z.string().min(1), description: z.string().optional(), filter: z.record(z.unknown()).nullish() }),
    req.body,
  );
  res.status(201).json(await suiteService.createSuite({ projectId: req.params.projectId, ...body }));
}));

r.patch("/suites/:id", requireProjectMember(projectFromSuite()), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ name: z.string().min(1).optional(), description: z.string().optional(), filter: z.record(z.unknown()).nullish() }),
    req.body,
  );
  res.json(await suiteService.updateSuite({ projectId: req.project!.id, suiteId: req.params.id, ...body }));
}));

r.post("/suites/:id/cases", requireProjectMember(projectFromSuite()), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ caseIds: z.array(z.string().uuid()).min(1) }), req.body);
  res.status(201).json(await suiteService.addCasesToSuite({ projectId: req.project!.id, suiteId: req.params.id, caseIds: body.caseIds }));
}));

r.get("/suites/:id/cases", requireProjectMember(projectFromSuite()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await suiteService.getSuiteCases(req.project!.id, req.params.id));
}));

// ---------- plans ----------
r.get("/projects/:projectId/plans", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await planService.listPlans(req.params.projectId));
}));

r.post("/projects/:projectId/plans", requireProjectMember(), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ name: z.string().min(1), description: z.string().optional(), releaseId: z.string().uuid().nullish() }),
    req.body,
  );
  res.status(201).json(await planService.createPlan({ projectId: req.params.projectId, ...body, createdBy: req.user.id }));
}));

r.patch("/plans/:id", requireProjectMember(projectFromPlan()), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(["draft", "active", "closed"]).optional(),
      releaseId: z.string().uuid().nullish(),
    }),
    req.body,
  );
  res.json(await planService.updatePlan({ projectId: req.project!.id, planId: req.params.id, ...body }));
}));

export default r;
