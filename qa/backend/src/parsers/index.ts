import { ParseError, ParseResult } from "./types";
import { parseJUnit } from "./junit";
import { parseXUnit } from "./xunit";
import { parseTrx } from "./trx";
import { parseAllureJson } from "./allure";

export type IngestFormat = "junit" | "xunit" | "trx" | "allure_json";

export function parseReport(format: IngestFormat, content: string): ParseResult {
  switch (format) {
    case "junit":
      return parseJUnit(content);
    case "xunit":
      return parseXUnit(content);
    case "trx":
      return parseTrx(content);
    case "allure_json":
      return parseAllureJson(content);
    default:
      throw new ParseError(`Unsupported report format '${format}'`);
  }
}

export { ParseError } from "./types";
export type { ParseResult, ParsedTest, ParsedStatus } from "./types";
