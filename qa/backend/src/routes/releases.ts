import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import { projectFromRelease } from "./helpers";
import * as releaseService from "../services/releaseService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const GATE = ["owner", "qa_lead"] as const;

const gatePolicySchema = z.object({
  minPassRate: z.number().min(0).max(1).optional(),
  maxOpenBlockers: z.number().int().nonnegative().optional(),
  maxOpenCritical: z.number().int().nonnegative().optional(),
  maxOpenDefects: z.number().int().nonnegative().optional(),
  maxOpenDefectsBySeverity: z.record(z.number().int().nonnegative()).optional(),
  minRequirementCoverage: z.number().min(0).max(1).optional(),
  maxFlakyInSuite: z.number().int().nonnegative().optional(),
  requiredSuites: z.array(z.string()).optional(),
});

r.get("/projects/:projectId/releases", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await releaseService.listReleases(req.params.projectId));
}));

r.post("/projects/:projectId/releases", requireProjectMember(), requireRole(GATE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1),
      targetBuildId: z.string().uuid().nullish(),
      plannedDate: z.string().nullish(),
      gatePolicy: gatePolicySchema.optional(),
    }),
    req.body,
  );
  res.status(201).json(await releaseService.createRelease({ projectId: req.params.projectId, ...body }));
}));

r.patch("/releases/:id", requireProjectMember(projectFromRelease()), requireRole(GATE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1).optional(),
      targetBuildId: z.string().uuid().nullish(),
      plannedDate: z.string().nullish(),
      status: z.enum(["planning", "testing", "gated", "released", "cancelled"]).optional(),
      gatePolicy: gatePolicySchema.optional(),
    }),
    req.body,
  );
  res.json(await releaseService.updateRelease({ projectId: req.project!.id, releaseId: req.params.id, ...body }));
}));

r.post("/releases/:id/gate/evaluate", requireProjectMember(projectFromRelease()), requireRole(GATE), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await releaseService.evaluateReleaseGate({
    projectId: req.project!.id,
    releaseId: req.params.id,
    organizationId: req.user.organizationId,
  }));
}));

r.post("/releases/:id/gate/override", requireProjectMember(projectFromRelease()), requireRole(GATE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ justification: z.string().min(1) }), req.body);
  res.json(await releaseService.overrideGate({
    projectId: req.project!.id,
    releaseId: req.params.id,
    justification: body.justification,
    actorId: req.user.id,
    organizationId: req.user.organizationId,
    ip: req.ip,
  }));
}));

r.get("/releases/:id/report", requireProjectMember(projectFromRelease()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await releaseService.releaseReport(req.project!.id, req.params.id));
}));

export default r;
