import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJUnit } from "../../src/parsers/junit";
import { parseXUnit } from "../../src/parsers/xunit";
import { parseTrx } from "../../src/parsers/trx";
import { parseAllureJson } from "../../src/parsers/allure";
import { ParseError } from "../../src/parsers/types";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

describe("JUnit parser", () => {
  it("parses a real fixture: 10 tests, 2 failures, 1 skipped", () => {
    const r = parseJUnit(fixture("junit-10-tests-2-failures.xml"));
    expect(r.total).toBe(10);
    expect(r.failures).toBe(2);
    expect(r.skipped).toBe(1);
    const failed = r.tests.filter((t) => t.status === "failed");
    expect(failed).toHaveLength(2);
    expect(failed[0].message).toContain("AssertionError");
    expect(failed[0].stack).toContain("payment.test.ts");
    expect(failed[0].derivedKey).toBe("Checkout.checkout.PaymentTest#test_capture_payment");
  });

  it("returns 400-position ParseError on malformed XML, never throws raw", () => {
    expect(() => parseJUnit("<testsuites><unclosed>")).toThrow(ParseError);
  });
});

describe("xUnit parser", () => {
  it("parses a real fixture: 4 tests, 1 failure", () => {
    const r = parseXUnit(fixture("xunit-auth.xml"));
    expect(r.total).toBe(4);
    expect(r.failures).toBe(1);
    const failed = r.tests.find((t) => t.status === "failed")!;
    expect(failed.testName).toBe("Refresh_Expired_Token_Fails");
    expect(failed.message).toContain("Assert.Equal");
  });
});

describe("TRX parser", () => {
  it("parses a real fixture: 3 tests, 1 failed", () => {
    const r = parseTrx(fixture("trx-api.trx"));
    expect(r.total).toBe(3);
    expect(r.failures).toBe(1);
    const failed = r.tests.find((t) => t.status === "failed")!;
    expect(failed.testName).toBe("Api_Post_Validates");
    expect(failed.className).toBe("Qa.Tests.ApiTests");
    expect(failed.message).toContain("Assert.AreEqual");
    const passed = r.tests.find((t) => t.testName === "Api_Get_Returns_200")!;
    expect(passed.durationMs).toBe(1250);
  });
});

describe("Allure parser", () => {
  it("parses a real fixture: 3 tests, 1 failed, 1 skipped", () => {
    const r = parseAllureJson(fixture("allure-login.json"));
    expect(r.total).toBe(3);
    expect(r.failures).toBe(1);
    expect(r.skipped).toBe(1);
    const failed = r.tests.find((t) => t.status === "failed")!;
    expect(failed.suiteName).toBe("Auth");
    expect(failed.message).toContain("AssertionError");
  });

  it("reports a parse position on malformed JSON", () => {
    try {
      parseAllureJson("{ not json ");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
  });
});
