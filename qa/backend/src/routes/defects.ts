import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole, resolveProjectRole } from "../middleware/auth";
import { projectFromDefect } from "./helpers";
import * as defectService from "../services/defectService";
import { dispatchWebhook } from "../services/webhookService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const TRIAGE = ["owner", "qa_lead", "tester", "developer"] as const;

r.get("/projects/:projectId/defects", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  const q = parse(
    z.object({ status: z.string().optional(), severity: z.string().optional(), priority: z.string().optional(), q: z.string().optional(), assignedTo: z.string().uuid().optional() }),
    req.query,
  );
  res.json(await defectService.listDefects(req.params.projectId, q));
}));

r.post("/defects", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      severity: z.enum(["trivial", "minor", "major", "critical", "blocker"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      status: z.string().optional(),
      assignedTo: z.string().uuid().nullish(),
      foundInBuildId: z.string().uuid().nullish(),
      environmentId: z.string().uuid().nullish(),
      fromExecutionIds: z.array(z.string().uuid()).optional(),
    }),
    req.body,
  );
  const resolved = await resolveProjectRole(req.user.id, req.user.organizationId, body.projectId);
  if (!resolved) return res.status(404).json({ error: "NotFound", message: "Project not found" });
  if (!["owner", "qa_lead", "tester", "developer"].includes(resolved.projectRole)) {
    return res.status(403).json({ error: "Forbidden", message: "Requires role: owner, qa_lead, tester or developer" });
  }
  const defect = await defectService.createDefect({
    projectId: body.projectId,
    title: body.title,
    description: body.description,
    severity: body.severity,
    priority: body.priority,
    status: body.status,
    assignedTo: body.assignedTo,
    foundInBuildId: body.foundInBuildId,
    environmentId: body.environmentId,
    fromExecutionIds: body.fromExecutionIds,
    reportedBy: req.user.id,
    actorId: req.user.id,
    organizationId: req.user.organizationId,
    ip: req.ip,
  });
  await dispatchWebhook("defect.created", { defectId: defect.id, ref: defect.ref, projectId: body.projectId }, req.user.organizationId);
  res.status(201).json(defect);
}));

r.get("/defects/:id", requireProjectMember(projectFromDefect()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await defectService.getDefect(req.project!.id, req.params.id));
}));

r.patch("/defects/:id", requireProjectMember(projectFromDefect()), requireRole(TRIAGE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      status: z.enum(["new", "triaged", "in_progress", "resolved", "verified", "closed", "reopened", "wont_fix", "duplicate"]).optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      severity: z.enum(["trivial", "minor", "major", "critical", "blocker"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assignedTo: z.string().uuid().nullish(),
      resolution: z.string().nullish(),
      duplicateOfId: z.string().uuid().nullish(),
    }),
    req.body,
  );
  const before = await defectService.getDefect(req.project!.id, req.params.id);
  const defect = await defectService.updateDefect({
    projectId: req.project!.id,
    defectId: req.params.id,
    ...body,
    actorId: req.user.id,
    organizationId: req.user.organizationId,
    ip: req.ip,
  });
  if (body.status && before.status !== body.status) {
    await dispatchWebhook("defect.status_changed", { defectId: defect.id, ref: defect.ref, fromStatus: before.status, toStatus: body.status, projectId: req.project!.id }, req.user.organizationId);
  }
  res.json(defect);
}));

r.post("/defects/:id/comments", requireProjectMember(projectFromDefect()), requireRole(TRIAGE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ comment: z.string().min(1) }), req.body);
  res.json(await defectService.addDefectComment({ projectId: req.project!.id, defectId: req.params.id, comment: body.comment, actorId: req.user.id }));
}));

r.post("/defects/:id/duplicate-of", requireProjectMember(projectFromDefect()), requireRole(TRIAGE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ duplicateOfId: z.string().uuid() }), req.body);
  res.json(await defectService.markDuplicate({
    projectId: req.project!.id,
    defectId: req.params.id,
    duplicateOfId: body.duplicateOfId,
    actorId: req.user.id,
    organizationId: req.user.organizationId,
    ip: req.ip,
  }));
}));

export default r;
