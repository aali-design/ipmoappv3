export interface QueryResult {
  rows: any[];
  rowCount: number | null;
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export interface DB extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

// Split a multi-statement SQL file into individual statements, stripping
// `--` line comments. Sufficient for our DDL (no procedural bodies).
export function splitSql(sql: string): string[] {
  const lines = sql
    .split("\n")
    .map((l) => {
      const idx = l.indexOf("--");
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");

  const out: string[] = [];
  let cur = "";
  for (const ch of lines) {
    if (ch === ";") {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}
