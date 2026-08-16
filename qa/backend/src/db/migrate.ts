import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../util/logger";
import type { DB } from "./types";
import { splitSql } from "./types";

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "schema.sql"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export interface MigrationResult {
  applied: string[];
  citext: boolean;
}

export async function runMigrations(db: DB): Promise<MigrationResult> {
  const root = findProjectRoot();
  const applied: string[] = [];

  // citext support detection (PGlite and other minimal engines lack it).
  let citext = true;
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS citext");
  } catch {
    citext = false;
    log.warn("citext extension unavailable; falling back to lower() unique index on users.email");
  }

  // Baseline schema (idempotent).
  let schema = readFileSync(join(root, "schema.sql"), "utf8");
  if (!citext) {
    schema = schema.replace(/email\s+citext\s+NOT NULL\s+UNIQUE/gi, "email text NOT NULL");
  }
  for (const stmt of splitSql(schema)) {
    await db.query(stmt);
  }
  if (!citext) {
    await db.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email))",
    );
  }

  // Incremental migrations in lexicographic order.
  const migDir = join(root, "migrations");
  if (existsSync(migDir)) {
    const files = readdirSync(migDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const name = file;
      const existing = await db.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (existing.rows.length > 0) continue;
      const body = readFileSync(join(migDir, file), "utf8");
      await db.transaction(async (tx) => {
        for (const stmt of splitSql(body)) {
          await tx.query(stmt);
        }
        await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      });
      applied.push(name);
    }
  }

  log.info("migrations complete", { applied: applied.length, citext });
  return { applied, citext };
}
