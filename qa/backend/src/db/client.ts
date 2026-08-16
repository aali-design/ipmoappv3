import { Pool } from "pg";
import { config } from "../config";
import type { DB, Queryable } from "./types";

let current: DB | null = null;

export function setDb(db: DB): void {
  current = db;
}

export function getDb(): DB {
  if (!current) {
    initPool();
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return current!;
}

export function initPool(): DB {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const db: DB = {
    async query(text, params = []) {
      const res = await pool.query(text, params as any[]);
      return { rows: res.rows, rowCount: res.rowCount };
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Queryable = {
          async query(t, p = []) {
            const res = await client.query(t, p as any[]);
            return { rows: res.rows, rowCount: res.rowCount };
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
  current = db;
  return db;
}

export function query(text: string, params?: unknown[]) {
  return getDb().query(text, params);
}

export function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

export async function closeDb(): Promise<void> {
  // Best-effort teardown; the pool has no public close handle here.
  current = null;
}
