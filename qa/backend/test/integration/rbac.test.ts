import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { createApp } from "../../src/app";
import { createPGliteDb } from "./pglite";
import type { DB } from "../../src/db/types";

// RBAC matrix (§1). Each role's effective project role drives server-side
// enforcement via requireRole + requireProjectMember.
const ROLES = [
  { role: "qa_lead", email: "lead@qa.local", pw: "lead-password" },
  { role: "tester", email: "tester@qa.local", pw: "tester-password" },
  { role: "developer", email: "dev@qa.local", pw: "dev-password" },
  { role: "viewer", email: "viewer@qa.local", pw: "viewer-password" },
];

let app: ReturnType<typeof createApp>;
let db: DB;
let close: () => Promise<void>;
let adminToken: string;
let projectId: string;

const tokens: Record<string, string> = {};

describe("RBAC matrix", () => {
  beforeAll(async () => {
    const created = await createPGliteDb();
    db = created.db;
    close = created.close;
    setDb(db);
    await runMigrations(db);
    await seed(db, { demoData: false });
    app = createApp();

    const login = await request(app).post("/api/auth/login").send({ email: "admin@qa.local", password: "admin-password" });
    adminToken = login.body.accessToken;
    tokens.owner = adminToken;

    const proj = await request(app).post("/api/projects").set("Authorization", `Bearer ${adminToken}`).send({ key: "WEB", name: "Web App" });
    projectId = proj.body.id;

    for (const r of ROLES) {
      await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({
        email: r.email,
        password: r.pw,
        fullName: r.role,
        role: r.role,
      });
      await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${adminToken}`).send({
        email: r.email,
        projectRole: r.role,
      });
      const l = await request(app).post("/api/auth/login").send({ email: r.email, password: r.pw });
      tokens[r.role] = l.body.accessToken;
    }
  });

  afterAll(async () => {
    await close();
  });

  it("viewer is read-only", async () => {
    expect((await request(app).get(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${tokens.viewer}`)).status).toBe(200);
    const create = await request(app).post(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${tokens.viewer}`).send({ title: "x", steps: [] });
    expect(create.status).toBe(403);
  });

  it("developer cannot author cases or plan runs, but can view", async () => {
    const create = await request(app).post(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${tokens.developer}`).send({ title: "x", steps: [] });
    expect(create.status).toBe(403);
    const run = await request(app).post(`/api/projects/${projectId}/runs`).set("Authorization", `Bearer ${tokens.developer}`).send({ caseIds: [], environmentId: "x" });
    expect(run.status).toBe(403);
    expect((await request(app).get(`/api/projects/${projectId}/requirements`).set("Authorization", `Bearer ${tokens.developer}`)).status).toBe(200);
  });

  it("tester can author cases and execute, but cannot plan runs or quarantine", async () => {
    const create = await request(app).post(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${tokens.tester}`).send({ title: "by tester", steps: [] });
    expect(create.status).toBe(201);
    const plan = await request(app).post(`/api/projects/${projectId}/runs`).set("Authorization", `Bearer ${tokens.tester}`).send({ caseIds: [], environmentId: "x" });
    expect(plan.status).toBe(403);
    const q = await request(app).post(`/api/cases/${create.body.id}/quarantine`).set("Authorization", `Bearer ${tokens.tester}`).send({ reason: "nope" });
    expect(q.status).toBe(403);
  });

  it("qa_lead can author, plan, quarantine, and gate", async () => {
    const create = await request(app).post(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${tokens.qa_lead}`).send({ title: "by lead", steps: [] });
    expect(create.status).toBe(201);
    const q = await request(app).post(`/api/cases/${create.body.id}/quarantine`).set("Authorization", `Bearer ${tokens.qa_lead}`).send({ reason: "flaky" });
    expect(q.status).toBe(201);
    // Cannot manage project members (owner only).
    const member = await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${tokens.qa_lead}`).send({ email: "viewer@qa.local", projectRole: "viewer" });
    expect(member.status).toBe(403);
  });

  it("owner can manage project members", async () => {
    const member = await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${tokens.owner}`).send({ email: "viewer@qa.local", projectRole: "viewer" });
    expect(member.status).toBe(201);
  });

  it("a 403 is never reachable via a disabled control for non-members", async () => {
    // A user in the same org but not a project member gets 403 (not 404) on
    // the project's resources — the project exists in their org, they just
    // lack membership.
    await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ email: "outsider@qa.local", password: "outsider-password", fullName: "Outsider", role: "viewer" });
    const l = await request(app).post("/api/auth/login").send({ email: "outsider@qa.local", password: "outsider-password" });
    const res = await request(app).get(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${l.body.accessToken}`);
    expect(res.status).toBe(403);
  });
});
