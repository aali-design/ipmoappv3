import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ParseError, ParseResult, ParsedTest, buildDerivedKey } from "./types";

// Visual Studio Test Results (TRX) — MSTest / VSTest.
function validate(xml: string): void {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    const err = result as { err?: { msg: string; line: number; col: number } };
    throw new ParseError(`Malformed TRX XML: ${err.err?.msg ?? "invalid XML"}`, err.err ? { line: err.err.line, column: err.err.col } : undefined);
  }
}

// TRX durations are ISO 8601 durations like "00:00:01.2340000".
function trxDurationToMs(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const m = /^(?:(\d+)d\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(d);
  if (!m) return undefined;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  return Math.round(((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000);
}

const OUTCOME_MAP: Record<string, ParsedTest["status"]> = {
  Passed: "passed",
  Failed: "failed",
  NotExecuted: "skipped",
  Skipped: "skipped",
  Completed: "passed",
  Inconclusive: "skipped",
  Aborted: "failed",
};

export function parseTrx(xml: string): ParseResult {
  validate(xml);
  let parsed: any;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });
    parsed = parser.parse(xml);
  } catch (e: any) {
    throw new ParseError(`Malformed TRX XML: ${e?.message ?? "parse error"}`);
  }

  const run = parsed.TestRun;
  const results = run?.Results?.UnitTestResult ?? [];
  const resultList = Array.isArray(results) ? results : results ? [results] : [];

  // Build an executionId -> definition map for names.
  const defs = run?.TestDefinitions?.UnitTest ?? [];
  const defList = Array.isArray(defs) ? defs : defs ? [defs] : [];
  const defMap = new Map<string, any>();
  for (const d of defList) {
    defMap.set(d["@_id"], d);
    const execId = d.Execution?.["@_id"];
    if (execId) defMap.set(execId, d);
  }

  const tests: ParsedTest[] = [];
  for (const r of resultList) {
    const def = defMap.get(r["@_testId"]) ?? defMap.get(r["@_executionId"]);
    const testName = r["@_testName"] ?? def?.TestMethod?.["@_name"] ?? "";
    const className = def?.TestMethod?.["@_className"] ?? "";
    const suiteName = run["@_name"] ?? "";
    const status = OUTCOME_MAP[r["@_outcome"]] ?? "skipped";
    const output = r.Output;
    const errorInfo = output?.ErrorInfo;
    const message = errorInfo?.Message || errorInfo?.StackTrace || undefined;
    const stack = errorInfo?.StackTrace || undefined;

    tests.push({
      suiteName,
      className,
      testName,
      status,
      durationMs: trxDurationToMs(r["@_duration"]),
      message,
      stack,
      derivedKey: buildDerivedKey(suiteName, className, testName),
    });
  }

  const failures = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  return {
    format: "trx",
    tests,
    total: tests.length,
    failures,
    errors: 0,
    skipped,
    durationMs: tests.reduce((a, t) => a + (t.durationMs ?? 0), 0),
    name: run?.["@_name"],
  };
}
