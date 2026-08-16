import { query } from "../db/client";
import type { Queryable } from "../db/types";

const REFS: Record<string, { table: string; width: number }> = {
  REQ: { table: "requirements", width: 3 },
  TC: { table: "test_cases", width: 4 },
  BUG: { table: "defects", width: 4 },
};

// Generate the next sequential project-scoped reference (e.g. TC-0123).
export async function nextRef(
  projectId: string,
  prefix: keyof typeof REFS,
  tx?: Queryable,
): Promise<string> {
  const q: Queryable = tx ?? { query };
  const spec = REFS[prefix];
  const pattern = `^${prefix}-[0-9]+$`;
  const res = await q.query(
    `SELECT ref FROM ${spec.table} WHERE project_id = $1 AND ref ~ $2 ORDER BY ref DESC LIMIT 1`,
    [projectId, pattern],
  );
  let n = 0;
  if (res.rows.length > 0) {
    const num = parseInt(res.rows[0].ref.split("-")[1], 10);
    if (Number.isFinite(num)) n = num;
  }
  return `${prefix}-${String(n + 1).padStart(spec.width, "0")}`;
}
