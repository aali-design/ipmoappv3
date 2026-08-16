// Flakiness computation (spec §4.2). Pure functions so they are unit-testable
// and shared by the seeder, the ingestion recompute, and the metrics service.

export type Outcome = "passed" | "failed" | "untested" | "blocked" | "skipped" | "retest";

export interface FlakeVerdict {
  score: number;
  verdict: "stable" | "suspect" | "flaky";
}

export const MAX_FLAKE_WINDOW = 30;

// flake_score = transitions / max(1, total_runs - 1)
export function computeFlakeScore(totalRuns: number, transitions: number): number {
  if (totalRuns <= 0) return 0;
  const score = transitions / Math.max(1, totalRuns - 1);
  return Math.min(1, Math.max(0, score));
}

export function flakeVerdict(score: number): FlakeVerdict["verdict"] {
  if (score > 0.2) return "flaky";
  if (score >= 0.05) return "suspect";
  return "stable";
}

export function flakeScoreOf(input: { totalRuns: number; transitions: number }): number {
  return computeFlakeScore(input.totalRuns, input.transitions);
}

function isPass(o: string): boolean {
  return o === "passed";
}
function isFail(o: string): boolean {
  return o === "failed";
}

// Count pass->fail / fail->pass transitions in a plain sequence.
export function countTransitions(outcomes: string[]): number {
  let transitions = 0;
  for (let i = 1; i < outcomes.length; i++) {
    const a = outcomes[i - 1];
    const b = outcomes[i];
    if ((isPass(a) && isFail(b)) || (isFail(a) && isPass(b))) {
      transitions++;
    }
  }
  return transitions;
}

// Same-commit transition rule: a transition only counts when both the
// previous and current execution happened on the SAME commit_sha (same code,
// different outcome). Retry disagreements within a run also share a commit,
// so they are naturally counted here.
export interface CommitOutcome {
  outcome: string;
  commitSha: string | null;
}

export function countSameCommitTransitions(sequence: CommitOutcome[]): number {
  let transitions = 0;
  for (let i = 1; i < sequence.length; i++) {
    const a = sequence[i - 1];
    const b = sequence[i];
    if (!a.commitSha || a.commitSha !== b.commitSha) continue;
    if ((isPass(a.outcome) && isFail(b.outcome)) || (isFail(a.outcome) && isPass(b.outcome))) {
      transitions++;
    }
  }
  return transitions;
}

// Compute a rolling-window flake score from an ordered execution history.
export function rollingFlakeScore(
  history: CommitOutcome[],
  windowSize: number = MAX_FLAKE_WINDOW,
): { totalRuns: number; transitions: number; score: number; verdict: FlakeVerdict["verdict"] } {
  const recent = history.slice(-windowSize);
  const totalRuns = recent.length;
  const transitions = countSameCommitTransitions(recent);
  const score = computeFlakeScore(totalRuns, transitions);
  return { totalRuns, transitions, score, verdict: flakeVerdict(score) };
}
