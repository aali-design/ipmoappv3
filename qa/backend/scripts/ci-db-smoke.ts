import request from "supertest";
import { initPool, closeDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { seed, waitForDb } from "../src/db/seed";
import { createApp } from "../src/app";
import { config } from "../src/config";

// CI smoke: run migrations + seed + a health/login check against a REAL
// containerized Postgres 16 (via DATABASE_URL), exercising the citext path
// that the in-process PGlite test adapter skips. Fails loudly if the
// containerized database contract breaks.
async function main(): Promise<void> {
  const db = initPool();
  try {
    await waitForDb(db);

    const { applied, citext } = await runMigrations(db);
    if (!citext) {
      throw new Error("expected citext extension to be available on real Postgres 16");
    }

    await seed(db, { demoData: false });

    const admin = await db.query("SELECT id FROM users WHERE email = $1", [config.adminEmail]);
    if (admin.rows.length !== 1) {
      throw new Error(`seeded admin ${config.adminEmail} not found (got ${admin.rows.length})`);
    }

    const app = createApp();
    const health = await request(app).get("/api/health");
    if (health.status !== 200 || health.body.db !== "up") {
      throw new Error(`health check failed: ${health.status} ${JSON.stringify(health.body)}`);
    }

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: config.adminEmail, password: config.adminPassword });
    if (login.status !== 200 || !login.body.accessToken) {
      throw new Error(`admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }

    console.log(
      `CI DB smoke OK — migrations applied: ${applied.length}, citext: ${citext}, db: ${health.body.db}`,
    );
  } finally {
    closeDb();
  }
  // closeDb only clears the module-level handle; the pg pool has no public
  // close here, so force exit to keep the CI step from hanging.
  process.exit(0);
}

main().catch((e) => {
  console.error("CI DB smoke FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
