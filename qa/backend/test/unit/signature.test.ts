import { describe, it, expect } from "vitest";
import {
  normalizeErrorText,
  failureSignature,
  clusterBySignature,
} from "../../src/intelligence/signature";

describe("failure signature normalization", () => {
  it("strips timestamps, hex addresses, uuids, line numbers, and absolute paths", () => {
    const input =
      "TypeError at /home/user/project/src/app.ts:42:12 - request abcd1234-12ab-34cd-56ef-abcdef123456 failed at 2024-01-15T10:00:00.000Z (0x7f8a1b2c3d4e)";
    const out = normalizeErrorText(input);
    expect(out).not.toContain("2024-01-15");
    expect(out).not.toContain("abcd1234-12ab-34cd-56ef-abcdef123456");
    expect(out).not.toContain("0x7f8a");
    expect(out).not.toContain("/home/user/project");
    expect(out).not.toMatch(/app\.ts:\d+/);
    expect(out).toContain("<uuid>");
    expect(out).toContain("<path>");
  });

  it("produces identical signatures for structurally identical failures", () => {
    const a = failureSignature({
      errorType: "AssertionError",
      message: "expected 200 but got 500 at 2024-01-15T10:00:00.000Z",
      frames: ["at test (file.ts:42:12)"],
    });
    const b = failureSignature({
      errorType: "AssertionError",
      message: "expected 200 but got 500 at 2024-03-20T11:30:00.000Z",
      frames: ["at test (file.ts:99:7)"],
    });
    expect(a).toBe(b);
  });

  it("produces different signatures for genuinely different failures", () => {
    const a = failureSignature({ errorType: "AssertionError", message: "expected 200 but got 500", frames: [] });
    const b = failureSignature({ errorType: "TimeoutError", message: "operation timed out", frames: [] });
    expect(a).not.toBe(b);
  });

  it("clusters failures by signature with counts", () => {
    const clusters = clusterBySignature([
      { signature: "aaa", id: "1", executedAt: "2024-01-01T00:00:00Z" },
      { signature: "aaa", id: "2", executedAt: "2024-01-02T00:00:00Z" },
      { signature: "bbb", id: "3" },
    ]);
    expect(clusters).toHaveLength(2);
    const top = clusters[0];
    expect(top.signature).toBe("aaa");
    expect(top.count).toBe(2);
    expect(top.executionIds).toContain("1");
    expect(top.executionIds).toContain("2");
    expect(top.firstSeen).toBe("2024-01-01T00:00:00Z");
    expect(top.lastSeen).toBe("2024-01-02T00:00:00Z");
  });
});
