import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ParseError, ParseResult, ParsedTest, buildDerivedKey } from "./types";

function validate(xml: string): void {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    const err = result as { err?: { msg: string; line: number; col: number } };
    throw new ParseError(
      `Malformed JUnit XML: ${err.err?.msg ?? "invalid XML"}`,
      err.err ? { line: err.err.line, column: err.err.col } : undefined,
    );
  }
}

function toMs(timeAttr: string | number | undefined): number | undefined {
  if (timeAttr === undefined || timeAttr === null || timeAttr === "") return undefined;
  const n = Number(timeAttr);
  return Number.isFinite(n) ? Math.round(n * 1000) : undefined;
}

export function parseJUnit(xml: string): ParseResult {
  validate(xml);
  let parsed: any;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });
    parsed = parser.parse(xml);
  } catch (e: any) {
    throw new ParseError(`Malformed JUnit XML: ${e?.message ?? "parse error"}`);
  }

  const tests: ParsedTest[] = [];
  const root = parsed.testsuites ?? parsed.testsuite;
  let suiteList: any[] = [];

  if (Array.isArray(root)) {
    suiteList = root;
  } else if (root && root.testsuite) {
    suiteList = Array.isArray(root.testsuite) ? root.testsuite : [root.testsuite];
  } else if (root) {
    suiteList = [root];
  }

  for (const suite of suiteList) {
    const suiteName = suite["@_name"] ?? suite.name ?? "";
    const cases = suite.testcase ? (Array.isArray(suite.testcase) ? suite.testcase : [suite.testcase]) : [];
    for (const tc of cases) {
      const className = tc["@_classname"] ?? tc["@_class"] ?? "";
      const testName = tc["@_name"] ?? "";
      let status: ParsedTest["status"] = "passed";
      let message: string | undefined;
      let stack: string | undefined;

      if (tc.failure || tc.error) {
        status = "failed";
        const node = Array.isArray(tc.failure) ? tc.failure[0] : tc.failure ?? (Array.isArray(tc.error) ? tc.error[0] : tc.error);
        message = node?.["@_message"] ?? node?.["@_type"] ?? "failure";
        stack = typeof node === "object" && node ? (node["#text"] ?? node._text) : undefined;
      } else if (tc.skipped || tc["@_skipped"] !== undefined) {
        status = "skipped";
      }

      tests.push({
        suiteName,
        className,
        testName,
        status,
        durationMs: toMs(tc["@_time"]),
        message,
        stack: typeof stack === "string" ? stack : undefined,
        derivedKey: buildDerivedKey(suiteName, className, testName),
      });
    }
  }

  const failures = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const durationMs = tests.reduce((a, t) => a + (t.durationMs ?? 0), 0);
  return {
    format: "junit",
    tests,
    total: tests.length,
    failures,
    errors: 0,
    skipped,
    durationMs,
  };
}
