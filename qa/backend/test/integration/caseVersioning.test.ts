import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { setDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { createPGliteDb } from "./pglite";
import {
  createCase,
  updateCase,
  getCase,
  getCaseVersion,
} from "../../src/services/caseService";
import type { DB } from "../../src/db/types";

let db: DB;
let close: () => Promise<void>;
let projectId: string;

beforeAll(async () => {
  const created = await createPGliteDb();
  db = created.db;
  close = created.close;
  setDb(db);
  await runMigrations(db);
  const ctx = await seed(db, { demoData: false });
  projectId = randomUUID();
  await db.query(
    "INSERT INTO projects (id, organization_id, key, name) VALUES ($1,$2,$3,$4)",
    [projectId, ctx.orgId, "WEB", "Web App"],
  );
});

afterAll(async () => {
  await close();
});

describe("test-case version immutability (§9.7)", () => {
  it("editing a case creates version N+1 and preserves the original version", async () => {
    const created = await createCase({
      projectId,
      title: "Login works",
      steps: [{ index: 1, action: "Given a valid user", expected: "login succeeds" }],
    });
    expect(created.currentVersion).toBe(1);
    const caseId = created.id;

    const updated = await updateCase({
      projectId,
      caseId,
      steps: [
        { index: 1, action: "Given a valid user", expected: "login succeeds" },
        { index: 2, action: "When MFA enabled", expected: "prompt for code" },
      ],
      changeNote: "added MFA step",
    });
    expect(updated.currentVersion).toBe(2);

    const v1 = await getCaseVersion(projectId, caseId, 1);
    expect(v1.version).toBe(1);
    expect(v1.steps).toHaveLength(1);
    expect(v1.steps[0].action).toBe("Given a valid user");
    expect(v1.steps[0].expected).toBe("login succeeds");

    const v2 = await getCaseVersion(projectId, caseId, 2);
    expect(v2.version).toBe(2);
    expect(v2.steps).toHaveLength(2);
    expect(v2.changeNote).toBe("added MFA step");

    const full = await getCase(projectId, caseId);
    expect(full.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(full.steps).toHaveLength(2);
  });

  it("each edit increments the version and never mutates a prior version row", async () => {
    const created = await createCase({
      projectId,
      title: "Multi-edit case",
      steps: [{ index: 1, action: "original action", expected: "original expected" }],
    });
    const caseId = created.id;

    for (let i = 0; i < 3; i++) {
      await updateCase({
        projectId,
        caseId,
        steps: [{ index: 1, action: `action ${i}`, expected: `expected ${i}` }],
      });
    }

    const full = await getCase(projectId, caseId);
    expect(full.currentVersion).toBe(4);
    expect(full.versions).toHaveLength(4);

    const v1 = await getCaseVersion(projectId, caseId, 1);
    expect(v1.steps[0].action).toBe("original action");
    expect(v1.steps[0].expected).toBe("original expected");
  });
});
