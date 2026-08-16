import { ParseError, ParseResult, ParsedTest, buildDerivedKey } from "./types";

// Allure TestResult JSON (allure_json ingest format). Accepts either a single
// TestResult object or an array of them.
const STATUS_MAP: Record<string, ParsedTest["status"]> = {
  passed: "passed",
  failed: "failed",
  broken: "failed",
  skipped: "skipped",
  unknown: "skipped",
};

function labelOf(labels: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!labels) return "";
  const found = labels.find((l) => l.name === name);
  return found?.value ?? "";
}

export function parseAllureJson(text: string): ParseResult {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    // Extract a rough position from the JSON parse error when available.
    const m = /position (\d+)/.exec(e?.message ?? "");
    throw new ParseError(
      `Malformed Allure JSON: ${e?.message ?? "invalid JSON"}`,
      m ? Number(m[1]) : undefined,
    );
  }

  const items = Array.isArray(data) ? data : [data];
  const tests: ParsedTest[] = [];

  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const testName = it.name ?? "";
    const suite = labelOf(it.labels, "suite") || labelOf(it.labels, "parentSuite") || "";
    const className = labelOf(it.labels, "testClass") || labelOf(it.labels, "package") || "";
    const rawStatus = (it.status ?? "unknown").toString();
    const status = STATUS_MAP[rawStatus] ?? "skipped";
    const details = it.statusDetails ?? {};
    tests.push({
      suiteName: suite,
      className,
      testName,
      status,
      durationMs: typeof it.time?.duration === "number" ? Math.round(it.time.duration) : undefined,
      message: details.message,
      stack: details.trace,
      derivedKey: buildDerivedKey(suite, className, testName),
    });
  }

  const failures = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  return {
    format: "allure_json",
    tests,
    total: tests.length,
    failures,
    errors: 0,
    skipped,
    durationMs: tests.reduce((a, t) => a + (t.durationMs ?? 0), 0),
  };
}
