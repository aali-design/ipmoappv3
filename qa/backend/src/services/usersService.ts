import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import { hashPassword } from "../util/password";
import { err } from "../util/errors";

const ROLES = ["owner", "qa_lead", "tester", "developer", "viewer"];

export async function listUsers(organizationId: string) {
  const res = await query(
    `SELECT id, email, full_name, role, is_active, last_login_at, created_at
     FROM users WHERE organization_id = $1 ORDER BY created_at ASC`,
    [organizationId],
  );
  return res.rows.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  }));
}

export async function createUser(input: {
  organizationId: string;
  email: string;
  password: string;
  fullName: string;
  role: string;
}) {
  if (!ROLES.includes(input.role)) throw err.validation("Invalid role");
  const existing = await query("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing.rows.length > 0) throw err.conflict("Email already exists");
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  await query(
    `INSERT INTO users (id, organization_id, email, password_hash, full_name, role)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.organizationId, input.email, passwordHash, input.fullName, input.role],
  );
  return { id, email: input.email, fullName: input.fullName, role: input.role };
}

export async function updateUser(input: {
  organizationId: string;
  userId: string;
  fullName?: string;
  role?: string;
  isActive?: boolean;
  password?: string;
}) {
  const existing = await query(
    "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
    [input.userId, input.organizationId],
  );
  if (existing.rows.length === 0) throw err.notFound("User not found");

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.fullName !== undefined) {
    sets.push(`full_name = $${i++}`);
    params.push(input.fullName);
  }
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role)) throw err.validation("Invalid role");
    sets.push(`role = $${i++}`);
    params.push(input.role);
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(input.isActive);
  }
  if (input.password !== undefined) {
    const hash = await hashPassword(input.password);
    sets.push(`password_hash = $${i++}`);
    params.push(hash);
  }
  if (sets.length === 0) return { id: input.userId };

  params.push(input.userId);
  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i}`, params);
  return { id: input.userId };
}
