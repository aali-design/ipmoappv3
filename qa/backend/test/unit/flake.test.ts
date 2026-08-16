import { describe, it, expect } from "vitest";
import {
  computeFlakeScore,
  flakeVerdict,
  countTransitions,
  countSameCommitTransitions,
  rollingFlakeScore,
} from "../../src/intelligence/flake";

describe("flake score math", () => {
  it("computes score = transitions / max(1, total_runs - 1)", () => {
    expect(computeFlakeScore(10, 9)).toBeCloseTo(1, 5);
    expect(computeFlakeScore(10, 0)).toBe(0);
    expect(computeFlakeScore(0, 0)).toBe(0);
    expect(computeFlakeScore(10, 100)).toBe(1); // clamped to [0,1]
  });

  it("classifies verdicts by threshold", () => {
    expect(flakeVerdict(0.02)).toBe("stable");
    expect(flakeVerdict(0.05)).toBe("suspect");
    expect(flakeVerdict(0.20)).toBe("suspect");
    expect(flakeVerdict(0.21)).toBe("flaky");
  });

  it("counts pass/fail transitions", () => {
    expect(countTransitions(["passed", "failed", "passed"])).toBe(2);
    expect(countTransitions(["passed", "passed", "passed"])).toBe(0);
    expect(countTransitions(["passed", "skipped", "failed"])).toBe(0);
  });

  it("only counts transitions on the same commit (same-commit rule)", () => {
    const seq = [
      { outcome: "passed", commitSha: "aaa" },
      { outcome: "failed", commitSha: "aaa" }, // transition (same commit)
      { outcome: "passed", commitSha: "bbb" }, // not a transition (different commit)
      { outcome: "failed", commitSha: null }, // no commit -> no transition
    ];
    expect(countSameCommitTransitions(seq)).toBe(1);
  });

  it("computes a rolling-window flake score", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      outcome: i % 2 === 0 ? "passed" : "failed",
      commitSha: "same-commit",
    }));
    const result = rollingFlakeScore(history);
    expect(result.totalRuns).toBe(30);
    expect(result.transitions).toBe(29);
    expect(result.verdict).toBe("flaky");
  });
});
