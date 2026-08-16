import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { err } from "../util/errors";

const PROJECT_ROLES = ["owner", "qa_lead", "tester", "developer", "viewer"];

export async function listProjects(organizationId: string) {
  const res = await query(
    `SELECT p.id, p.key, p.name, p.description, p.default_environment_id, p.archived_at, p.settings_json, p.created_at,
            (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
     FROM projects p WHERE p.organization_id = $1 AND p.archived_at IS NULL
     ORDER BY p.created_at ASC`,
    [organizationId],
  );
  return res.rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    defaultEnvironmentId: p.default_environment_id,
    settings: p.settings_json,
    memberCount: Number(p.member_count),
    createdAt: p.created_at,
  }));
}

export async function createProject(input: {
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  actorId: string;
  actorRole: string;
}) {
  if (!/^[A-Za-z0-9_-]{1,10}$/.test(input.key)) throw err.validation("Key must be alphanumeric, up to 10 chars");
  const dup = await query(
    "SELECT id FROM projects WHERE organization_id = $1 AND key = $2",
    [input.organizationId, input.key],
  );
  if (dup.rows.length > 0) throw err.conflict("A project with this key already exists");

  const id = randomUUID();
  // Creator's project role mirrors their global role (owner stays owner).
  const projectRole = input.actorRole === "owner" ? "owner" : input.actorRole;
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO projects (id, organization_id, key, name, description)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, input.organizationId, input.key, input.name, input.description ?? null],
    );
    await tx.query(
      "INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1,$2,$3)",
      [id, input.actorId, projectRole],
    );
  });
  return { id, key: input.key, name: input.name };
}

export async function getProject(organizationId: string, projectId: string) {
  const res = await query(
    "SELECT * FROM projects WHERE id = $1 AND organization_id = $2",
    [projectId, organizationId],
  );
  if (res.rows.length === 0) throw err.notFound("Project not found");
  const p = res.rows[0];
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    defaultEnvironmentId: p.default_environment_id,
    settings: p.settings_json,
    createdAt: p.created_at,
  };
}

export async function updateProject(input: {
  organizationId: string;
  projectId: string;
  name?: string;
  description?: string;
  settings?: Record<string, unknown>;
}) {
  const existing = await query(
    "SELECT id FROM projects WHERE id = $1 AND organization_id = $2",
    [input.projectId, input.organizationId],
  );
  if (existing.rows.length === 0) throw err.notFound("Project not found");

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(input.description);
  }
  if (input.settings !== undefined) {
    sets.push(`settings_json = $${i++}::jsonb`);
    params.push(JSON.stringify(input.settings));
  }
  if (sets.length) {
    params.push(input.projectId);
    await query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }
  return getProject(input.organizationId, input.projectId);
}

export async function listMembers(organizationId: string, projectId: string) {
  const res = await query(
    `SELECT pm.user_id, pm.project_role, u.email, u.full_name, u.role AS global_role
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND u.organization_id = $2
     ORDER BY u.created_at ASC`,
    [projectId, organizationId],
  );
  return res.rows.map((m) => ({
    userId: m.user_id,
    email: m.email,
    fullName: m.full_name,
    projectRole: m.project_role,
    globalRole: m.global_role,
  }));
}

export async function addMember(input: {
  organizationId: string;
  projectId: string;
  email: string;
  projectRole: string;
}) {
  if (!PROJECT_ROLES.includes(input.projectRole)) throw err.validation("Invalid project role");
  const user = await query(
    "SELECT id, organization_id FROM users WHERE email = $1",
    [input.email],
  );
  if (user.rows.length === 0) throw err.notFound("User not found");
  if (user.rows[0].organization_id !== input.organizationId) throw err.notFound("User not found");

  await query(
    `INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1,$2,$3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role`,
    [input.projectId, user.rows[0].id, input.projectRole],
  );
  return { userId: user.rows[0].id, projectRole: input.projectRole };
}

export async function removeMember(input: {
  organizationId: string;
  projectId: string;
  userId: string;
}) {
  await query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [
    input.projectId,
    input.userId,
  ]);
  return { ok: true };
}

export async function listEnvironments(projectId: string) {
  const res = await query(
    "SELECT id, name, base_url, notes, created_at FROM environments WHERE project_id = $1 ORDER BY created_at ASC",
    [projectId],
  );
  return res.rows.map((e) => ({
    id: e.id,
    name: e.name,
    baseUrl: e.base_url,
    notes: e.notes,
    createdAt: e.created_at,
  }));
}

export async function createEnvironment(input: {
  projectId: string;
  name: string;
  baseUrl?: string;
  notes?: string;
}) {
  const id = randomUUID();
  await query(
    "INSERT INTO environments (id, project_id, name, base_url, notes) VALUES ($1,$2,$3,$4,$5)",
    [id, input.projectId, input.name, input.baseUrl ?? null, input.notes ?? null],
  );
  return { id, name: input.name };
}
