import { PGlite } from "@electric-sql/pglite";
import type { DB, Queryable, QueryResult } from "../../src/db/types";

// In-process Postgres (WASM) adapter used by integration tests so they run
// without a Dockerized database. Mirrors the node-postgres DB interface.
export async function createPGliteDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const pglite = new PGlite();

  const run = async (text: string, params: unknown[] = []): Promise<QueryResult> => {
    const res = await pglite.query(text, params as any[]);
    return { rows: res.rows as any[], rowCount: res.affectedRows ?? null };
  };

  const db: DB = {
    query: run,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pglite.transaction(async (tx) => {
        const txq: Queryable = {
          async query(t, p = []) {
            const res = await tx.query(t, p as any[]);
            return { rows: res.rows as any[], rowCount: res.affectedRows ?? null };
          },
        };
        return fn(txq);
      });
    },
  };

  return { db, close: async () => pglite.close() };
}
