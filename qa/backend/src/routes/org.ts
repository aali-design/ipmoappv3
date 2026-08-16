import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth } from "../middleware/auth";
import * as usersService from "../services/usersService";
import * as webhookService from "../services/webhookService";
import type { AuthedRequest } from "../types/express";

const r = Router();
r.use(requireAuth);

function requireOwner(req: AuthedRequest, res: any): boolean {
  if (req.user.role !== "owner") {
    res.status(403).json({ error: "Forbidden", message: "Only owners can perform this action" });
    return false;
  }
  return true;
}

// ---------- Users (org-level admin) ----------
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(["owner", "qa_lead", "tester", "developer", "viewer"]),
});

r.get("/users", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  res.json(await usersService.listUsers(req.user.organizationId));
}));

r.post("/users", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  const body = parse(createUserSchema, req.body);
  res.status(201).json(await usersService.createUser({ organizationId: req.user.organizationId, ...body }));
}));

r.patch("/users/:id", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  const body = parse(
    z.object({
      fullName: z.string().min(1).optional(),
      role: z.enum(["owner", "qa_lead", "tester", "developer", "viewer"]).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8).optional(),
    }),
    req.body,
  );
  res.json(await usersService.updateUser({ organizationId: req.user.organizationId, userId: req.params.id, ...body }));
}));

// ---------- Webhooks (org-level) ----------
const webhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1),
});

r.get("/webhooks", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  res.json(await webhookService.listWebhooks(req.user.organizationId));
}));

r.post("/webhooks", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  const body = parse(webhookSchema, req.body);
  res.status(201).json(await webhookService.createWebhook({ organizationId: req.user.organizationId, ...body }));
}));

r.delete("/webhooks/:id", asyncHandler(async (req: AuthedRequest, res) => {
  if (!requireOwner(req, res)) return;
  res.json(await webhookService.deleteWebhook(req.user.organizationId, req.params.id));
}));

export default r;
