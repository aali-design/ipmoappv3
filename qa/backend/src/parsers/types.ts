// Normalized parse result shared by every report format parser.

export type ParsedStatus = "passed" | "failed" | "skipped" | "blocked";

export interface ParsedTest {
  suiteName: string;
  className: string;
  testName: string;
  status: ParsedStatus;
  durationMs?: number;
  message?: string;
  stack?: string;
  automationKey?: string;
  derivedKey: string; // suite.classname#testname
  properties?: Record<string, string>;
}

export interface ParseResult {
  format: "junit" | "xunit" | "trx" | "allure_json";
  tests: ParsedTest[];
  total: number;
  failures: number;
  errors: number;
  skipped: number;
  durationMs: number;
  name?: string;
}

// Parse errors carry a position so ingestion can return 400 with the location,
// never a 500.
export class ParseError extends Error {
  readonly position?: { line: number; column: number } | number;
  constructor(message: string, position?: { line: number; column: number } | number) {
    super(message);
    this.name = "ParseError";
    this.position = position;
  }
}

export function buildDerivedKey(suite: string, className: string, testName: string): string {
  return `${suite || ""}.${className || ""}#${testName || ""}`;
}
