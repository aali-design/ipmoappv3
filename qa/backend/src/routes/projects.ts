import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth, requireProjectMember, requireRole } from "../middleware/auth";
import * as projectService from "../services/projectService";
import * as apiKeyService from "../services/apiKeyService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

const READ = ["owner", "qa_lead", "tester", "developer", "viewer"] as const;
const MANAGE = ["owner"] as const;

r.get("/projects", asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await projectService.listProjects(req.user.organizationId));
}));

r.post("/projects", asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ key: z.string().min(1).max(10), name: z.string().min(1), description: z.string().optional() }),
    req.body,
  );
  const proj = await projectService.createProject({
    organizationId: req.user.organizationId,
    key: body.key,
    name: body.name,
    description: body.description,
    actorId: req.user.id,
    actorRole: req.user.role,
  });
  res.status(201).json(proj);
}));

r.get("/projects/:projectId", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await projectService.getProject(req.user.organizationId, req.params.projectId));
}));

r.patch("/projects/:projectId", requireProjectMember(), requireRole(MANAGE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      settings: z.record(z.unknown()).optional(),
    }),
    req.body,
  );
  res.json(await projectService.updateProject({ organizationId: req.user.organizationId, projectId: req.params.projectId, ...body }));
}));

// ---------- members ----------
r.get("/projects/:projectId/members", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await projectService.listMembers(req.user.organizationId, req.params.projectId));
}));

r.post("/projects/:projectId/members", requireProjectMember(), requireRole(MANAGE), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ email: z.string().email(), projectRole: z.enum(["owner", "qa_lead", "tester", "developer", "viewer"]) }),
    req.body,
  );
  res.status(201).json(await projectService.addMember({ organizationId: req.user.organizationId, projectId: req.params.projectId, ...body }));
}));

r.delete("/projects/:projectId/members/:userId", requireProjectMember(), requireRole(MANAGE), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await projectService.removeMember({ organizationId: req.user.organizationId, projectId: req.params.projectId, userId: req.params.userId }));
}));

// ---------- api keys ----------
r.get("/api-keys", asyncHandler(async (req: AuthedRequest, res) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden", message: "Only owners can manage API keys" });
  }
  res.json(await apiKeyService.listApiKeys(req.user.organizationId));
}));

r.post("/api-keys", asyncHandler(async (req: AuthedRequest, res) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden", message: "Only owners can manage API keys" });
  }
  const body = parse(
    z.object({
      name: z.string().min(1),
      projectId: z.string().uuid().nullish(),
      scopes: z.array(z.string()).optional(),
      expiresAt: z.string().nullish(),
    }),
    req.body,
  );
  res.status(201).json(await apiKeyService.createApiKey({ organizationId: req.user.organizationId, projectId: body.projectId ?? null, name: body.name, scopes: body.scopes, expiresAt: body.expiresAt, actorId: req.user.id }));
}));

r.delete("/api-keys/:id", asyncHandler(async (req: AuthedRequest, res) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden", message: "Only owners can manage API keys" });
  }
  res.json(await apiKeyService.revokeApiKey(req.user.organizationId, req.params.id));
}));

// ---------- environments ----------
r.get("/projects/:projectId/environments", requireProjectMember(), asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await projectService.listEnvironments(req.params.projectId));
}));

r.post("/projects/:projectId/environments", requireProjectMember(), requireRole(["owner", "qa_lead"]), asyncHandler(async (req: AuthedRequest, res) => {
  const body = parse(
    z.object({ name: z.string().min(1), baseUrl: z.string().optional(), notes: z.string().optional() }),
    req.body,
  );
  res.status(201).json(await projectService.createEnvironment({ projectId: req.params.projectId, ...body }));
}));

// ---------- audit log ----------
r.get("/audit-log", asyncHandler(async (req: AuthedRequest, res) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden", message: "Only owners can view the audit log" });
  }
  const { query } = await import("../db/client");
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const rows = await query(
    `SELECT id, actor_id, action, entity_type, entity_id, metadata_json, ip, created_at
     FROM audit_log WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.user.organizationId, limit],
  );
  res.json(rows.rows.map((a) => ({
    id: a.id,
    actorId: a.actor_id,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    metadata: a.metadata_json,
    ip: a.ip,
    createdAt: a.created_at,
  })));
}));

export default r;
