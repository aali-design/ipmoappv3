import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { createApp } from "../../src/app";
import { createPGliteDb } from "./pglite";
import type { DB } from "../../src/db/types";

// Regression guards for two live-app bugs found during founder review:
// 1. "Create case" failed because the frontend sends `estimatedMinutes: null`
//    when the field is empty, but the schema only accepted `undefined`.
// 2. A run's progress bar never advanced because run stats were only
//    refreshed on completion, not when an execution was marked.
let app: ReturnType<typeof createApp>;
let db: DB;
let close: () => Promise<void>;
let adminToken: string;
let projectId: string;
let environmentId: string;

beforeAll(async () => {
  const created = await createPGliteDb();
  db = created.db;
  close = created.close;
  setDb(db);
  await runMigrations(db);
  await seed(db, { demoData: false });
  app = createApp();

  const login = await request(app).post("/api/auth/login").send({ email: "admin@qa.local", password: "admin-password" });
  expect(login.status).toBe(200);
  adminToken = login.body.accessToken;

  const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${adminToken}`).send({ key: "REG", name: "Regression" });
  projectId = project.body.id;

  const env = await request(app).post(`/api/projects/${projectId}/environments`).set("Authorization", `Bearer ${adminToken}`).send({ name: "staging" });
  environmentId = env.body.id;
});

afterAll(async () => {
  await close();
});

describe("regression: create case with null optional numerics", () => {
  it("accepts estimatedMinutes: null (frontend sends null when empty)", async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/cases`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Case with empty estimate",
        folderPath: "/",
        priority: "medium",
        type: "functional",
        automationStatus: "manual",
        automationKey: null,
        tags: [],
        preconditions: "",
        expectedResult: "",
        estimatedMinutes: null,
        steps: [{ index: 1, action: "open", expected: "loads" }],
      });
    expect(res.status).toBe(201);
    expect(res.body.estimatedMinutes).toBeNull();
  });
});

describe("regression: run progress advances on execution updates", () => {
  it("refreshes run stats when an execution is marked", async () => {
    const caseRes = await request(app)
      .post(`/api/projects/${projectId}/cases`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Progress case", steps: [{ index: 1, action: "do", expected: "done" }] });
    const caseId = caseRes.body.id;

    const runRes = await request(app)
      .post(`/api/projects/${projectId}/runs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caseIds: [caseId], environmentId, name: "Progress run" });
    expect(runRes.status).toBe(201);
    const runId = runRes.body.id;

    // Stats are initialized on creation (0 executed).
    let run = await request(app).get(`/api/runs/${runId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(run.body.stats).toBeTruthy();
    expect(run.body.stats.total).toBe(1);
    expect(run.body.stats.untested).toBe(1);

    await request(app).post(`/api/runs/${runId}/start`).set("Authorization", `Bearer ${adminToken}`).send({});

    const execs = await request(app).get(`/api/runs/${runId}/executions`).set("Authorization", `Bearer ${adminToken}`);
    const executionId = execs.body[0].id;

    const patch = await request(app)
      .patch(`/api/executions/${executionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "passed" });
    expect(patch.status).toBe(200);

    // Stats must reflect the marked execution before the run completes.
    run = await request(app).get(`/api/runs/${runId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(run.body.stats.passed).toBe(1);
    expect(run.body.stats.untested).toBe(0);
  });
});
