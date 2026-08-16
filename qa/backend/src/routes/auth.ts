import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { parse } from "../util/validate";
import { requireAuth } from "../middleware/auth";
import { authRateLimit } from "../middleware/rateLimit";
import * as authService from "../services/authService";
import type { AuthedRequest } from "../types/express";

const r = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  organizationName: z.string().min(1),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

r.post("/register", authRateLimit(), asyncHandler(async (req, res) => {
  const body = parse(registerSchema, req.body);
  const result = await authService.register(body);
  res.status(201).json(result);
}));

r.post("/login", authRateLimit(), asyncHandler(async (req, res) => {
  const body = parse(loginSchema, req.body);
  res.json(await authService.login(body));
}));

r.post("/refresh", authRateLimit(), asyncHandler(async (req, res) => {
  const body = parse(refreshSchema, req.body);
  res.json(await authService.refresh(body.refreshToken));
}));

r.post("/logout", requireAuth, asyncHandler(async (_req, res) => {
  res.json({ ok: true });
}));

r.get("/me", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await authService.me(req.user.id));
}));

export default r;
