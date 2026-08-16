import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { hashPassword, verifyPassword } from "../util/password";
import { signToken, verifyToken } from "../util/jwt";
import { err } from "../util/errors";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function issueTokens(user: { id: string; organization_id: string; role: string; email: string }) {
  const base = {
    sub: user.id,
    organization_id: user.organization_id,
    role: user.role,
    email: user.email,
  };
  const accessToken = signToken({ ...base, type: "access", jti: randomUUID() });
  const refreshToken = signToken({ ...base, type: "refresh", jti: randomUUID() });
  return { accessToken, refreshToken };
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  organizationName: string;
}

export async function register(input: RegisterInput) {
  const existing = await query("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing.rows.length > 0) throw err.conflict("An account with this email already exists");

  let slug = slugify(input.organizationName);
  if (!slug) slug = `org-${randomUUID().slice(0, 8)}`;
  const slugTaken = await query("SELECT id FROM organizations WHERE slug = $1", [slug]);
  if (slugTaken.rows.length > 0) slug = `${slug}-${randomUUID().slice(0, 6)}`;

  const orgId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);

  await withTransaction(async (tx) => {
    await tx.query("INSERT INTO organizations (id, name, slug) VALUES ($1,$2,$3)", [
      orgId,
      input.organizationName,
      slug,
    ]);
    await tx.query(
      `INSERT INTO users (id, organization_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,$5,'owner')`,
      [userId, orgId, input.email, passwordHash, input.fullName],
    );
  });

  const user = { id: userId, organization_id: orgId, role: "owner", email: input.email };
  return { ...issueTokens(user), user: { id: userId, email: input.email, fullName: input.fullName, role: "owner", organizationId: orgId } };
}

export async function login(input: { email: string; password: string }) {
  const res = await query(
    "SELECT id, organization_id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1",
    [input.email],
  );
  const user = res.rows[0];
  if (!user || !user.is_active) throw err.invalidCredentials();
  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) throw err.invalidCredentials();

  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  return {
    ...issueTokens(user),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      organizationId: user.organization_id,
    },
  };
}

export async function refresh(refreshToken: string) {
  let claims;
  try {
    claims = verifyToken(refreshToken);
  } catch {
    throw err.tokenExpired("Refresh token invalid or expired");
  }
  if (claims.type !== "refresh") throw err.unauthorized("Not a refresh token");

  const res = await query(
    "SELECT id, organization_id, email, role, is_active FROM users WHERE id = $1",
    [claims.sub],
  );
  const user = res.rows[0];
  if (!user || !user.is_active) throw err.unauthorized();

  const accessToken = signToken({
    sub: user.id,
    organization_id: user.organization_id,
    role: user.role,
    email: user.email,
    type: "access",
    jti: randomUUID(),
  });
  return { accessToken };
}

export async function me(userId: string) {
  const res = await query(
    "SELECT id, organization_id, email, full_name, role, is_active, last_login_at, created_at FROM users WHERE id = $1",
    [userId],
  );
  if (res.rows.length === 0) throw err.notFound("User not found");
  const u = res.rows[0];
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    organizationId: u.organization_id,
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}
