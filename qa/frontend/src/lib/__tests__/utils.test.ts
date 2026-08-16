import { describe, expect, it } from "vitest";
import { clamp, pct, toCsv } from "@/lib/utils";
import { can } from "@/lib/rbac";

describe("utils", () => {
  it("formats percentages", () => {
    expect(pct(0.943, 1)).toBe("94.3%");
    expect(pct(1, 0)).toBe("100%");
  });

  it("clamps values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("escapes CSV values", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("a,b\n1,2");
    expect(toCsv([['say "hi"', "line\nbreak"]])).toBe(
      '"say ""hi""","line\nbreak"',
    );
  });
});

describe("rbac", () => {
  it("grants owner all permissions", () => {
    expect(can("owner", "approve_gate")).toBe(true);
    expect(can("owner", "manage_project")).toBe(true);
  });

  it("denies viewer write permissions", () => {
    expect(can("viewer", "author_cases")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
  });

  it("tester cannot approve gate but can execute", () => {
    expect(can("tester", "approve_gate")).toBe(false);
    expect(can("tester", "execute_tests")).toBe(true);
  });
});
