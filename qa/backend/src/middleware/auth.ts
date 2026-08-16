import type { NextFunction, Request, Response } from "express";
import { query } from "../db/client";
import { verifyToken } from "../util/jwt";
import { err } from "../util/errors";
import { hashApiKey } from "../util/apiKey";
import type { AuthUser } from "../types/express";

export type Role = "owner" | "qa_lead" | "tester" | "developer" | "viewer";

const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  developer: 1,
  tester: 2,
  qa_lead: 3,
  owner: 4,
};

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) throw err.unauthorized();
    let claims;
    try {
      claims = verifyToken(token);
    } catch (e: any) {
      if (e?.name === "TokenExpiredError") throw err.tokenExpired();
      throw err.unauthorized("Invalid token");
    }
    if (claims.type !== "access") throw err.unauthorized("Refresh tokens cannot access resources");

    // Re-read the user to confirm they are still active and in this org.
    const res = await query(
      "SELECT id, organization_id, email, role, is_active FROM users WHERE id = $1",
      [claims.sub],
    );
    const user = res.rows[0];
    if (!user || !user.is_active) throw err.unauthorized("User is inactive or missing");

    (req as any).user = {
      id: user.id,
      organizationId: user.organization_id,
      email: user.email,
      role: user.role,
    } as AuthUser;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const key = (req.headers["x-api-key"] as string) || (req.headers["authorization"]?.startsWith("Bearer ") ? req.headers["authorization"].slice(7) : undefined);
    if (!key) throw err.unauthorized("API key required");
    const hash = hashApiKey(key);
    const res = await query(
      `SELECT id, organization_id, project_id, scopes, expires_at, revoked_at
       FROM api_keys WHERE key_hash = $1`,
      [hash],
    );
    const row = res.rows[0];
    if (!row) throw err.unauthorized("Invalid API key");
    if (row.revoked_at) throw err.unauthorized("API key revoked");
    if (row.expires_at && new Date(row.expires_at) < new Date()) throw err.unauthorized("API key expired");
    (req as any).apiKey = {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      scopes: row.scopes ?? [],
    };
    next();
  } catch (e) {
    next(e);
  }
}

// Resolve the effective project role for a user: org owner is implicitly
// `owner`; otherwise the project_members.project_role applies.
export async function resolveProjectRole(
  userId: string,
  organizationId: string,
  projectId: string,
): Promise<{ projectRole: string; isMember: boolean; projectKey: string } | null> {
  const proj = await query(
    "SELECT id, organization_id, key FROM projects WHERE id = $1",
    [projectId],
  );
  if (proj.rows.length === 0) return null;
  if (proj.rows[0].organization_id !== organizationId) return null; // tenant isolation

  const userRow = await query("SELECT role FROM users WHERE id = $1 AND organization_id = $2", [
    userId,
    organizationId,
  ]);
  if (userRow.rows.length === 0) return null;
  const globalRole = userRow.rows[0].role as Role;
  if (globalRole === "owner") {
    return { projectRole: "owner", isMember: true, projectKey: proj.rows[0].key };
  }

  const member = await query(
    "SELECT project_role FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  if (member.rows.length === 0) return { projectRole: "viewer", isMember: false, projectKey: proj.rows[0].key };
  return { projectRole: member.rows[0].project_role, isMember: true, projectKey: proj.rows[0].key };
}

type ProjectResolver = (req: Request) => Promise<string | undefined> | string | undefined;

export function requireProjectMember(resolve?: ProjectResolver) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user as AuthUser | undefined;
      if (!user) throw err.unauthorized();
      const projectId = resolve ? await resolve(req) : (req.params.projectId as string | undefined);
      if (!projectId) throw err.badRequest("Missing project id");

      const resolved = await resolveProjectRole(user.id, user.organizationId, projectId);
      if (!resolved) {
        // Tenant isolation: foreign org projects look like they don't exist.
        throw err.notFound("Project not found");
      }
      if (!resolved.isMember) throw err.forbidden("You are not a member of this project");
      (req as any).project = { id: projectId, role: resolved.projectRole, key: resolved.projectKey };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const project = (req as any).project;
    if (!project) return next(err.forbidden());
    const userRole = project.role as Role;
    const requiredMin = Math.min(...roles.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[userRole] < requiredMin) {
      return next(err.forbidden(`Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}
