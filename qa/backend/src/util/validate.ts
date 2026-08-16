import type { z } from "zod";
import { err } from "./errors";

// Validate a value against a zod schema, throwing a uniform ValidationError
// (400) with the flattened issues as `details`.
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw err.validation("Request validation failed", issues);
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  return parse(schema, value);
}
