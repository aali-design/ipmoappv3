import { describe, it, expect } from "vitest";
import {
  computeRiskScore,
  normalizeWeights,
  DEFAULT_RISK_WEIGHTS,
} from "../../src/intelligence/risk";

describe("risk scoring", () => {
  it("computes a weighted score with a factor breakdown", () => {
    const result = computeRiskScore({
      requirementCriticality: "critical",
      recentFailureRate: 0.5,
      recencyOfCodeChange: 1,
      casePriority: "high",
      flakeScore: 0.3,
    });
    expect(result.riskScore).toBeGreaterThan(0);
    // critical -> 1.0 * 0.3 = 0.30; failure 0.5*0.25=0.125; recency 1*0.2=0.2; priority 0.7*0.2=0.14; flake -0.3*0.05=-0.015
    expect(result.riskScore).toBeCloseTo(0.3 + 0.125 + 0.2 + 0.14 - 0.015, 3);
    expect(result.factors.requirementCriticality.contribution).toBeCloseTo(0.3, 3);
    expect(result.factors.flakePenalty.contribution).toBeLessThan(0);
  });

  it("uses configurable weights", () => {
    const weights = normalizeWeights({ requirementCriticality: 1, recentFailureRate: 0, recencyOfCodeChange: 0, casePriority: 0, flakePenalty: 0 });
    const result = computeRiskScore(
      { requirementCriticality: "critical", recentFailureRate: 0, recencyOfCodeChange: 0, casePriority: "low", flakeScore: 0 },
      weights,
    );
    expect(result.riskScore).toBeCloseTo(1, 3);
  });

  it("clamps scores to 0..1 and never negative", () => {
    const result = computeRiskScore(
      { requirementCriticality: "low", recentFailureRate: 0, recencyOfCodeChange: 0, casePriority: "low", flakeScore: 1 },
      DEFAULT_RISK_WEIGHTS,
    );
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });

  it("falls back to defaults for missing weights", () => {
    const w = normalizeWeights({});
    expect(w).toEqual(DEFAULT_RISK_WEIGHTS);
  });
});
