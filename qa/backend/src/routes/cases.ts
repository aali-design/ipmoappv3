import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import { projectFromCase } from "./helpers";
import * as caseService from "../services/caseService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const WRITE = ["owner", "qa_lead", "tester"] as const;
const READ = ["owner", "qa_lead", "tester", "developer", "viewer"] as const;

const stepSchema = z.object({ index: z.number().int().nonnegative(), action: z.string(), expected: z.string() });

const caseBodySchema = z.object({
  title: z.string().min(1),
  ref: z.string().max(24).optional(),
  folderPath: z.string().max(256).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  type: z.enum(["functional", "regression", "smoke", "integration", "e2e", "performance", "security"]).optional(),
  automationStatus: z.enum(["manual", "automated", "candidate"]).optional(),
  automationKey: z.string().max(255).nullish(),
  ownerId: z.string().uuid().nullish(),
  preconditions: z.string().optional(),
  steps: z.array(stepSchema).optional(),
  expectedResult: z.string().optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  requirementIds: z.array(z.string().uuid()).optional(),
  changeNote: z.string().optional(),
});

r.get("/projects/:projectId/cases", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  const q = parse(
    z.object({
      folder: z.string().optional(),
      tag: z.string().optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      automation_status: z.string().optional(),
      q: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
    }),
    req.query,
  );
  res.json(await caseService.listCases(req.params.projectId, q, { page: q.page, pageSize: q.pageSize }));
}));

r.post("/projects/:projectId/cases", requireProjectMember(), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(caseBodySchema, req.body);
  res.status(201).json(await caseService.createCase({ projectId: req.params.projectId, ...body, authorId: req.user.id }));
}));

r.get("/cases/:id", requireProjectMember(projectFromCase()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await caseService.getCase(req.project!.id, req.params.id));
}));

r.patch("/cases/:id", requireProjectMember(projectFromCase()), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      title: z.string().min(1).optional(),
      folderPath: z.string().max(256).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      type: z.enum(["functional", "regression", "smoke", "integration", "e2e", "performance", "security"]).optional(),
      automationStatus: z.enum(["manual", "automated", "candidate"]).optional(),
      automationKey: z.string().max(255).nullish(),
      ownerId: z.string().uuid().nullish(),
      preconditions: z.string().optional(),
      steps: z.array(stepSchema).optional(),
      expectedResult: z.string().optional(),
      tags: z.array(z.string()).optional(),
      estimatedMinutes: z.number().int().positive().optional(),
      changeNote: z.string().optional(),
    }),
    req.body,
  );
  res.json(await caseService.updateCase({ projectId: req.project!.id, caseId: req.params.id, ...body, authorId: req.user.id }));
}));

r.get("/cases/:id/versions/:n", requireProjectMember(projectFromCase()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await caseService.getCaseVersion(req.project!.id, req.params.id, Number(req.params.n)));
}));

r.post("/cases/:id/requirements", requireProjectMember(projectFromCase()), requireRole(WRITE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(z.object({ requirementIds: z.array(z.string().uuid()).min(1) }), req.body);
  res.json(await caseService.linkRequirements(req.project!.id, req.params.id, body.requirementIds));
}));

r.post("/cases/bulk", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      projectId: z.string().uuid(),
      caseIds: z.array(z.string().uuid()).min(1),
      action: z.enum(["move", "tag", "archive", "unarchive"]),
      folderPath: z.string().max(256).optional(),
      tags: z.array(z.string()).optional(),
    }),
    req.body,
  );
  // Enforce membership + role manually (bulk spans many cases).
  const { resolveProjectRole } = await import("../middleware/auth");
  const resolved = await resolveProjectRole(req.user.id, req.user.organizationId, body.projectId);
  if (!resolved) return res.status(404).json({ error: "NotFound", message: "Project not found" });
  if (!["owner", "qa_lead", "tester"].includes(resolved.projectRole)) {
    return res.status(403).json({ error: "Forbidden", message: "Requires role: owner or qa_lead or tester" });
  }
  res.json(await caseService.bulkAction({ projectId: body.projectId, caseIds: body.caseIds, action: body.action, folderPath: body.folderPath, tags: body.tags }));
}));

r.get("/cases/:id/history", requireProjectMember(projectFromCase()), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await caseService.getCaseHistory(req.project!.id, req.params.id));
}));

export default r;
