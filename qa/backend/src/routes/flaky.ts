import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import { projectFromCase } from "./helpers";
import * as flakyService from "../services/flakyService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

r.get("/projects/:projectId/flaky", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await flakyService.listFlaky(req.params.projectId));
}));

r.post("/cases/:id/quarantine", requireProjectMember(projectFromCase()), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ reason: z.string().min(1), linkedDefectId: z.string().uuid().nullish() }), req.body);
  res.status(201).json(await flakyService.quarantineCase({
    projectId: req.project!.id,
    caseId: req.params.id,
    reason: body.reason,
    linkedDefectId: body.linkedDefectId,
    actorId: req.user.id,
  }));
}));

r.delete("/cases/:id/quarantine", requireProjectMember(projectFromCase()), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await flakyService.releaseQuarantine(req.project!.id, req.params.id));
}));

export default r;
