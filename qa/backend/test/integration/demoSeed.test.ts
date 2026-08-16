import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createPGliteDb } from "./pglite";
import { runMigrations } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import type { DB } from "../../src/db/types";

// Guards the full demo seed path (the one production runs on boot). The
// integration suite seeds with `demoData: false`, so a bug in the demo-data
// seeding (e.g. a foreign-key violation in the environments insert) went
// undetected until the first real deploy. This test runs the full path.
let db: DB;
let close: () => Promise<void>;

beforeAll(async () => {
  const created = await createPGliteDb();
  db = created.db;
  close = created.close;
  await runMigrations(db);
  await seed(db);
});

afterAll(async () => {
  await close();
});

describe("demo seed", () => {
  it("seeds a complete, consistent demo dataset", async () => {
    const count = async (table: string) => {
      const r = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      return r.rows[0].n as number;
    };

    expect(await count("organizations")).toBe(1);
    expect(await count("users")).toBe(6);
    expect(await count("projects")).toBe(2);
    expect(await count("requirements")).toBe(24);
    expect(await count("test_cases")).toBe(120);
    expect(await count("test_suites")).toBe(6);
    expect(await count("environments")).toBe(3);
    expect(await count("builds")).toBe(8);
    expect(await count("test_runs")).toBe(12);
    expect(await count("defects")).toBe(18);

    // No environment should point at a non-project (the historical FK bug).
    const bad = await db.query(
      `SELECT count(*)::int AS n FROM environments e
       LEFT JOIN projects p ON p.id = e.project_id WHERE p.id IS NULL`,
    );
    expect(bad.rows[0].n).toBe(0);
  });
});
