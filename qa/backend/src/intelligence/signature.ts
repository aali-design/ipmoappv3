import { createHash } from "node:crypto";

// Failure signature & auto-clustering (spec §4.1).
// failure_signature = sha256(normalize(errorType + topFrames(3) + normalizedMessage))
//
// Normalization strips: timestamps, hex addresses, UUIDs, line-number noise,
// and absolute paths — so that structurally identical failures share a
// signature even when runtime details differ.

const HEX_ADDRESS = /\b0x[0-9a-fA-F]{6,}\b/g;
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const ISO_TS = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const CLOCK = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
const LINE_NUM = /\.(?:ts|tsx|js|jsx|py|java|rb|go|cs|cpp|c|h|scala|kt):\d+(?::\d+)?\b/g;
const UNIX_PATH = /(?:\/[\w.-]+)+\.\w+/g;
const WIN_PATH = /\b[A-Za-z]:\\[\w.\-\\]+\b/g;
const MEM_ADDR = /\b0x[0-9a-fA-F]+\b/g;
const NUMERIC = /\b\d+\b/g;

export function normalizeErrorText(input: string): string {
  let s = input ?? "";
  s = s.replace(UUID, "<uuid>");
  s = s.replace(ISO_TS, "<ts>");
  s = s.replace(CLOCK, "<time>");
  s = s.replace(WIN_PATH, "<path>");
  s = s.replace(UNIX_PATH, "<path>");
  s = s.replace(LINE_NUM, ".<line>");
  s = s.replace(HEX_ADDRESS, "<addr>");
  s = s.replace(MEM_ADDR, "<addr>");
  s = s.replace(NUMERIC, "<n>");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

// Take the top `n` stack frames, normalize each, and join deterministically.
export function normalizeFrames(frames: string[], topN = 3): string {
  return frames
    .map((f) => normalizeErrorText(f))
    .slice(0, topN)
    .join("|");
}

export interface FailureInput {
  errorType: string;
  frames?: string[];
  message: string;
}

export function failureSignature(input: FailureInput): string {
  const normalized =
    normalizeErrorText(input.errorType) +
    "|" +
    normalizeFrames(input.frames ?? [], 3) +
    "|" +
    normalizeErrorText(input.message);
  return createHash("sha256").update(normalized).digest("hex");
}

// Cluster failures: group keys by identical signature with counts + span.
export function clusterBySignature(
  failures: Array<{ signature: string; executedAt?: string; id: string }>,
): Array<{
  signature: string;
  count: number;
  firstSeen?: string;
  lastSeen?: string;
  executionIds: string[];
}> {
  const map = new Map<string, { count: number; firstSeen?: string; lastSeen?: string; executionIds: string[] }>();
  for (const f of failures) {
    const cur = map.get(f.signature) ?? { count: 0, executionIds: [] };
    cur.count++;
    cur.executionIds.push(f.id);
    if (f.executedAt) {
      if (!cur.firstSeen || f.executedAt < cur.firstSeen) cur.firstSeen = f.executedAt;
      if (!cur.lastSeen || f.executedAt > cur.lastSeen) cur.lastSeen = f.executedAt;
    }
    map.set(f.signature, cur);
  }
  return [...map.entries()]
    .map(([signature, v]) => ({ signature, ...v }))
    .sort((a, b) => b.count - a.count);
}
