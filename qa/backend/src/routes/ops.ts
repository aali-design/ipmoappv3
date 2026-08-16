import { Router } from "express";
import { asyncHandler } from "../util/asyncHandler";
import { requireAuth, requireProjectMember } from "../middleware/auth";
import * as metricsService from "../services/metricsService";
import type { AuthedRequest } from "../types/express";

const r = Router();

r.get("/projects/:projectId/metrics", requireAuth, requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await metricsService.metrics(req.params.projectId));
}));

r.get("/projects/:projectId/suggested-order", requireAuth, requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await metricsService.suggestedOrder(req.params.projectId));
}));

export default r;
