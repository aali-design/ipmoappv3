import { describe, it, expect } from "vitest";
import { evaluateGate, evaluateCriterion, type GateInputs } from "../../src/intelligence/gate";

function baseInputs(overrides: Partial<GateInputs> = {}): GateInputs {
  return {
    executed: 100,
    passed: 95,
    quarantinedExcluded: 0,
    runIds: ["run-1"],
    openDefectsBySeverity: {},
    openDefectIds: [],
    requirementCoverage: 0.95,
    coverageGaps: [],
    flakyInSuiteCount: 0,
    flakyCaseIds: [],
    suitesPresent: ["Smoke", "Regression"],
    ...overrides,
  };
}

describe("gate criteria evaluation", () => {
  it("minPassRate passes when actual >= required", () => {
    const c = evaluateCriterion("minPassRate", 0.98, baseInputs({ executed: 100, passed: 98 }));
    expect(c.passed).toBe(true);
    expect(c.actual).toBeCloseTo(0.98, 3);
    expect(c.evidence).toHaveProperty("runIds");
  });

  it("minPassRate fails when actual < required", () => {
    const c = evaluateCriterion("minPassRate", 0.98, baseInputs({ executed: 100, passed: 94 }));
    expect(c.passed).toBe(false);
    expect(c.actual).toBeCloseTo(0.94, 3);
  });

  it("maxOpenBlockers and maxOpenCritical compare counts", () => {
    const blockers = evaluateCriterion("maxOpenBlockers", 0, baseInputs({ openDefectsBySeverity: { blocker: 1 } }));
    expect(blockers.passed).toBe(false);
    expect(blockers.actual).toBe(1);

    const crit = evaluateCriterion("maxOpenCritical", 0, baseInputs({ openDefectsBySeverity: { critical: 0 } }));
    expect(crit.passed).toBe(true);
  });

  it("maxOpenDefects compares the total open-defect count", () => {
    const pass = evaluateCriterion(
      "maxOpenDefects",
      5,
      baseInputs({ openDefectsBySeverity: { minor: 1, major: 2, critical: 1 } }),
    );
    expect(pass.passed).toBe(true);
    expect(pass.actual).toBe(4);

    const fail = evaluateCriterion(
      "maxOpenDefects",
      3,
      baseInputs({ openDefectsBySeverity: { minor: 1, major: 2, critical: 1 } }),
    );
    expect(fail.passed).toBe(false);
    expect(fail.actual).toBe(4);
  });

  it("unknown criterion fails closed with an explanatory evidence payload", () => {
    const c = evaluateCriterion("notARealCriterion", 0, baseInputs());
    expect(c.passed).toBe(false);
    expect(c.actual).toBe("unknown");
    expect(c.evidence.error).toContain("unknown criterion");
  });

  it("maxOpenDefectsBySeverity reports per-severity violations", () => {
    const c = evaluateCriterion(
      "maxOpenDefectsBySeverity",
      { major: 5, critical: 0 },
      baseInputs({ openDefectsBySeverity: { major: 7, critical: 1 } }),
    );
    expect(c.passed).toBe(false);
    expect(c.actual).toEqual({ major: 7, critical: 1 });
    expect((c.evidence.violations as string[]).sort()).toEqual(["critical", "major"]);
  });

  it("minRequirementCoverage", () => {
    const pass = evaluateCriterion("minRequirementCoverage", 0.9, baseInputs({ requirementCoverage: 0.92 }));
    expect(pass.passed).toBe(true);
    const fail = evaluateCriterion("minRequirementCoverage", 0.9, baseInputs({ requirementCoverage: 0.8 }));
    expect(fail.passed).toBe(false);
  });

  it("maxFlakyInSuite", () => {
    expect(evaluateCriterion("maxFlakyInSuite", 3, baseInputs({ flakyInSuiteCount: 4 })).passed).toBe(false);
    expect(evaluateCriterion("maxFlakyInSuite", 3, baseInputs({ flakyInSuiteCount: 3 })).passed).toBe(true);
  });

  it("requiredSuites passes only when all named suites are present", () => {
    const c = evaluateCriterion("requiredSuites", ["Smoke", "Regression"], baseInputs({ suitesPresent: ["Smoke"] }));
    expect(c.passed).toBe(false);
    expect(c.actual).toEqual(["Regression"]);
  });

  it("evaluateGate returns blocking list and deterministic policyHash", () => {
    const policy = { minPassRate: 0.98, maxOpenBlockers: 0, requiredSuites: ["Smoke", "Regression"] };
    const inputs = baseInputs({ executed: 100, passed: 94, openDefectsBySeverity: { blocker: 1 } });
    const result = evaluateGate(policy, inputs, "2024-01-01T00:00:00Z");
    expect(result.verdict).toBe("fail");
    expect(result.blocking).toContain("minPassRate");
    expect(result.blocking).toContain("maxOpenBlockers");
    expect(result.policyHash).toMatch(/^sha256:/);

    // Deterministic: same inputs -> identical hash.
    const again = evaluateGate(policy, baseInputs({ executed: 100, passed: 94, openDefectsBySeverity: { blocker: 1 } }), "2024-01-01T00:00:00Z");
    expect(again.policyHash).toBe(result.policyHash);
  });

  it("returns pass when nothing blocks", () => {
    const result = evaluateGate({ minPassRate: 0.9 }, baseInputs({ executed: 100, passed: 95 }));
    expect(result.verdict).toBe("pass");
    expect(result.blocking).toEqual([]);
  });
});
