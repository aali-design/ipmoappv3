import { createHash } from "node:crypto";

// Quality Gate evaluation (spec §6). Pure + deterministic: same policy and
// inputs always produce identical output (including policyHash).

export interface GatePolicy {
  minPassRate?: number;
  maxOpenBlockers?: number;
  maxOpenCritical?: number;
  maxOpenDefects?: number;
  maxOpenDefectsBySeverity?: Record<string, number>;
  minRequirementCoverage?: number;
  maxFlakyInSuite?: number;
  requiredSuites?: string[];
}

export interface GateInputs {
  executed: number; // excluding quarantined
  passed: number; // excluding quarantined
  quarantinedExcluded: number;
  runIds: string[];
  openDefectsBySeverity: Record<string, number>;
  openDefectIds: string[];
  requirementCoverage: number; // 0..1
  coverageGaps: Array<{ ref: string; criticality: string }>;
  flakyInSuiteCount: number;
  flakyCaseIds: string[];
  suitesPresent: string[];
}

export interface CriterionResult {
  key: string;
  required: number | string[] | Record<string, number>;
  actual: number | string[] | Record<string, number> | string;
  passed: boolean;
  evidence: Record<string, unknown>;
}

export interface GateResult {
  verdict: "pass" | "fail";
  evaluatedAt: string;
  criteria: CriterionResult[];
  blocking: string[];
  policyHash: string;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function evaluateCriterion(key: string, required: unknown, inputs: GateInputs): CriterionResult {
  switch (key) {
    case "minPassRate": {
      const req = Number(required);
      const actual = inputs.executed > 0 ? round4(inputs.passed / inputs.executed) : 0;
      return {
        key,
        required: req,
        actual,
        passed: actual >= req,
        evidence: {
          executed: inputs.executed,
          passed: inputs.passed,
          quarantinedExcluded: inputs.quarantinedExcluded,
          excludedQuarantined: inputs.quarantinedExcluded,
          runIds: inputs.runIds,
        },
      };
    }
    case "maxOpenBlockers": {
      const req = Number(required);
      const actual = inputs.openDefectsBySeverity["blocker"] ?? 0;
      return {
        key,
        required: req,
        actual,
        passed: actual <= req,
        evidence: { blockers: inputs.openDefectIds.filter((_, i) => i < actual) },
      };
    }
    case "maxOpenCritical": {
      const req = Number(required);
      const actual = inputs.openDefectsBySeverity["critical"] ?? 0;
      return {
        key,
        required: req,
        actual,
        passed: actual <= req,
        evidence: { criticals: inputs.openDefectIds.filter((_, i) => i < actual) },
      };
    }
    case "maxOpenDefects": {
      const req = Number(required);
      const actual = Object.values(inputs.openDefectsBySeverity).reduce((a, b) => a + b, 0);
      return {
        key,
        required: req,
        actual,
        passed: actual <= req,
        evidence: { openDefects: inputs.openDefectIds },
      };
    }
    case "maxOpenDefectsBySeverity": {
      const req = (required ?? {}) as Record<string, number>;
      const actual: Record<string, number> = {};
      for (const sev of Object.keys(req)) {
        actual[sev] = inputs.openDefectsBySeverity[sev] ?? 0;
      }
      const failed = Object.keys(req).filter((sev) => actual[sev] > req[sev]);
      return {
        key,
        required: req,
        actual,
        passed: failed.length === 0,
        evidence: { bySeverity: actual, violations: failed },
      };
    }
    case "minRequirementCoverage": {
      const req = Number(required);
      const actual = round4(inputs.requirementCoverage);
      return {
        key,
        required: req,
        actual,
        passed: actual >= req,
        evidence: { coverage: actual, gaps: inputs.coverageGaps },
      };
    }
    case "maxFlakyInSuite": {
      const req = Number(required);
      const actual = inputs.flakyInSuiteCount;
      return {
        key,
        required: req,
        actual,
        passed: actual <= req,
        evidence: { flakyCaseIds: inputs.flakyCaseIds },
      };
    }
    case "requiredSuites": {
      const req = (required ?? []) as string[];
      const present = new Set(inputs.suitesPresent);
      const missing = req.filter((s) => !present.has(s));
      return {
        key,
        required: req,
        actual: missing,
        passed: missing.length === 0,
        evidence: { present: inputs.suitesPresent, missing },
      };
    }
    default:
      // Unknown criterion: fail closed with an explanatory evidence payload.
      return {
        key,
        required: required as never,
        actual: "unknown",
        passed: false,
        evidence: { error: `unknown criterion '${key}'` },
      };
  }
}

function canonicalActuals(criteria: CriterionResult[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of [...criteria].sort((a, b) => a.key.localeCompare(b.key))) {
    out[c.key] = { required: c.required, actual: c.actual };
  }
  return out;
}

export function evaluateGate(policy: GatePolicy, inputs: GateInputs, evaluatedAt: string = new Date().toISOString()): GateResult {
  const criteria: CriterionResult[] = Object.entries(policy)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => evaluateCriterion(key, value, inputs));

  const blocking = criteria.filter((c) => !c.passed).map((c) => c.key);
  const policyHash = "sha256:" + createHash("sha256")
    .update(JSON.stringify({ policy: canonicalPolicy(policy), actuals: canonicalActuals(criteria) }))
    .digest("hex");

  return {
    verdict: blocking.length === 0 ? "pass" : "fail",
    evaluatedAt,
    criteria,
    blocking,
    policyHash,
  };
}

function canonicalPolicy(policy: GatePolicy): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(policy).sort()) {
    out[k] = (policy as Record<string, unknown>)[k];
  }
  return out;
}
