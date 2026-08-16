import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import * as requirementService from "../services/requirementService";
import * as metricsService from "../services/metricsService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const WRITE = ["owner", "qa_lead", "tester"] as const;

r.get("/projects/:projectId/requirements", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  const q = parse(
    z.object({
      status: z.string().optional(),
      criticality: z.string().optional(),
      q: z.string().optional(),
    }),
    req.query,
  );
  res.json(await requirementService.listRequirements(req.params.projectId, q));
}));

r.post("/projects/:projectId/requirements", requireProjectMember(), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      ref: z.string().max(24).optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      criticality: z.enum(["low", "medium", "high", "critical"]).optional(),
      status: z.enum(["draft", "active", "deprecated"]).optional(),
    }),
    req.body,
  );
  res.status(201).json(await requirementService.createRequirement({ projectId: req.params.projectId, ...body }));
}));

r.patch("/projects/:projectId/requirements/:id", requireProjectMember(), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      criticality: z.enum(["low", "medium", "high", "critical"]).optional(),
      status: z.enum(["draft", "active", "deprecated"]).optional(),
    }),
    req.body,
  );
  res.json(await requirementService.updateRequirement({ projectId: req.params.projectId, id: req.params.id, ...body }));
}));

r.delete("/projects/:projectId/requirements/:id", requireProjectMember(), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await requirementService.deleteRequirement(req.params.projectId, req.params.id));
}));

r.get("/projects/:projectId/traceability", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  const rawBuildId = req.query.buildId as string | undefined;
  const buildId = rawBuildId && /^[0-9a-f-]{36}$/i.test(rawBuildId) ? rawBuildId : null;
  res.json(await metricsService.traceability(req.params.projectId, buildId));
}));

export default r;
