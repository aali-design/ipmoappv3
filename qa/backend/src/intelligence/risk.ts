// Risk-based prioritization (spec §4.3).
//
// risk_score = w1·requirementCriticality + w2·recentFailureRate(90d)
//            + w3·recencyOfCodeChange + w4·casePriority − w5·flakePenalty
//
// All factors are normalized to 0..1 so the weighted sum is interpretable.
// The weights are configurable per project (projects.settings_json.riskWeights).

export interface RiskWeights {
  requirementCriticality: number;
  recentFailureRate: number;
  recencyOfCodeChange: number;
  casePriority: number;
  flakePenalty: number;
}

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  requirementCriticality: 0.3,
  recentFailureRate: 0.25,
  recencyOfCodeChange: 0.2,
  casePriority: 0.2,
  flakePenalty: 0.05,
};

const CRITICALITY_SCORE: Record<string, number> = {
  low: 0.1,
  medium: 0.4,
  high: 0.7,
  critical: 1.0,
};

const PRIORITY_SCORE: Record<string, number> = {
  low: 0.1,
  medium: 0.4,
  high: 0.7,
  critical: 1.0,
};

export function normalizeWeights(input: Record<string, unknown> | undefined): RiskWeights {
  const src = (input ?? {}) as Partial<RiskWeights>;
  const out: RiskWeights = { ...DEFAULT_RISK_WEIGHTS };
  for (const k of Object.keys(DEFAULT_RISK_WEIGHTS) as Array<keyof RiskWeights>) {
    const v = Number(src[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export interface RiskFactors {
  requirementCriticality: string; // low|medium|high|critical (max over linked reqs)
  recentFailureRate: number; // 0..1 over last 90d
  recencyOfCodeChange: number; // 0..1 (1 = changed very recently)
  casePriority: string; // low|medium|high|critical
  flakeScore: number; // 0..1
}

export interface RiskResult {
  riskScore: number;
  factors: {
    requirementCriticality: { raw: string; normalized: number; weight: number; contribution: number };
    recentFailureRate: { raw: number; normalized: number; weight: number; contribution: number };
    recencyOfCodeChange: { raw: number; normalized: number; weight: number; contribution: number };
    casePriority: { raw: string; normalized: number; weight: number; contribution: number };
    flakePenalty: { raw: number; normalized: number; weight: number; contribution: number };
  };
}

export function computeRiskScore(f: RiskFactors, weights?: RiskWeights): RiskResult {
  const w = weights ?? DEFAULT_RISK_WEIGHTS;

  const critN = CRITICALITY_SCORE[f.requirementCriticality] ?? 0;
  const failN = clamp01(f.recentFailureRate);
  const recencyN = clamp01(f.recencyOfCodeChange);
  const prioN = PRIORITY_SCORE[f.casePriority] ?? 0;
  const flakeN = clamp01(f.flakeScore);

  const score =
    w.requirementCriticality * critN +
    w.recentFailureRate * failN +
    w.recencyOfCodeChange * recencyN +
    w.casePriority * prioN -
    w.flakePenalty * flakeN;

  const m = (contribution: number) => round4(contribution);
  const factors: RiskResult["factors"] = {
    requirementCriticality: { raw: f.requirementCriticality, normalized: critN, weight: w.requirementCriticality, contribution: m(w.requirementCriticality * critN) },
    recentFailureRate: { raw: round4(f.recentFailureRate), normalized: failN, weight: w.recentFailureRate, contribution: m(w.recentFailureRate * failN) },
    recencyOfCodeChange: { raw: round4(f.recencyOfCodeChange), normalized: recencyN, weight: w.recencyOfCodeChange, contribution: m(w.recencyOfCodeChange * recencyN) },
    casePriority: { raw: f.casePriority, normalized: prioN, weight: w.casePriority, contribution: m(w.casePriority * prioN) },
    flakePenalty: { raw: round4(f.flakeScore), normalized: flakeN, weight: w.flakePenalty, contribution: m(-w.flakePenalty * flakeN) },
  };

  return { riskScore: round4(Math.max(0, score)), factors };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
