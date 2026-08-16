import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ParseError, ParseResult, ParsedTest, buildDerivedKey } from "./types";

// .NET xUnit v2 XML report.
function validate(xml: string): void {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    const err = result as { err?: { msg: string; line: number; col: number } };
    throw new ParseError(`Malformed xUnit XML: ${err.err?.msg ?? "invalid XML"}`, err.err ? { line: err.err.line, column: err.err.col } : undefined);
  }
}

const RESULT_MAP: Record<string, ParsedTest["status"]> = {
  Pass: "passed",
  Fail: "failed",
  Skip: "skipped",
  SkipConditionally: "skipped",
};

export function parseXUnit(xml: string): ParseResult {
  validate(xml);
  let parsed: any;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });
    parsed = parser.parse(xml);
  } catch (e: any) {
    throw new ParseError(`Malformed xUnit XML: ${e?.message ?? "parse error"}`);
  }

  const tests: ParsedTest[] = [];
  const assemblies = parsed.assemblies?.assembly ?? [];
  const assemblyList = Array.isArray(assemblies) ? assemblies : assemblies ? [assemblies] : [];

  for (const asm of assemblyList) {
    const collections = asm.collection ?? [];
    const collectionList = Array.isArray(collections) ? collections : [collections];
    for (const col of collectionList) {
      const testsArr = col.test ?? [];
      const testList = Array.isArray(testsArr) ? testsArr : testsArr ? [testsArr] : [];
      for (const t of testList) {
        const suiteName = col["@_name"] ?? asm["@_name"] ?? "";
        const className = t["@_type"] ?? "";
        const testName = t["@_name"] ?? "";
        const rawResult = t["@_result"] ?? "Pass";
        const status = RESULT_MAP[rawResult] ?? "failed";
        const failure = t.failure;
        const msgRaw = typeof failure === "object" && failure ? failure.message : undefined;
        const message = typeof msgRaw === "string"
          ? msgRaw
          : msgRaw && typeof msgRaw === "object"
            ? msgRaw["#text"] ?? undefined
            : undefined;
        const stackRaw = typeof failure === "object" && failure ? failure["stack-trace"] : undefined;
        const stack = typeof stackRaw === "string" ? stackRaw : stackRaw?.["#text"] ?? undefined;

        tests.push({
          suiteName,
          className,
          testName,
          status,
          durationMs: t["@_time"] ? Math.round(Number(t["@_time"]) * 1000) : undefined,
          message,
          stack,
          derivedKey: buildDerivedKey(suiteName, className, testName),
        });
      }
    }
  }

  const failures = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  return {
    format: "xunit",
    tests,
    total: tests.length,
    failures,
    errors: 0,
    skipped,
    durationMs: tests.reduce((a, t) => a + (t.durationMs ?? 0), 0),
  };
}
