import { describe, it, expect } from "vitest";
import { RUN_TRANSITIONS, type RunStatus } from "../../src/services/runService";
import {
  DEFECT_TRANSITIONS,
  validateDefectTransition,
  type DefectStatus,
} from "../../src/services/defectService";
import { AppError } from "../../src/util/errors";

describe("run state machine (§3)", () => {
  it("planned -> in_progress -> (paused <-> in_progress) -> completed | aborted", () => {
    expect(RUN_TRANSITIONS.planned).toEqual(["in_progress", "aborted"]);
    expect(RUN_TRANSITIONS.in_progress).toEqual(["paused", "completed", "aborted"]);
    expect(RUN_TRANSITIONS.paused).toEqual(["in_progress", "completed", "aborted"]);
  });

  it("completed and aborted are terminal (no outgoing transitions)", () => {
    expect(RUN_TRANSITIONS.completed).toEqual([]);
    expect(RUN_TRANSITIONS.aborted).toEqual([]);
  });

  it("planned can never jump straight to completed or paused", () => {
    expect(RUN_TRANSITIONS.planned).not.toContain("completed");
    expect(RUN_TRANSITIONS.planned).not.toContain("paused");
  });
});

describe("defect state machine (§3)", () => {
  it("new -> triaged -> in_progress -> resolved -> verified -> closed", () => {
    expect(DEFECT_TRANSITIONS.new).toContain("triaged");
    expect(DEFECT_TRANSITIONS.triaged).toContain("in_progress");
    expect(DEFECT_TRANSITIONS.in_progress).toContain("resolved");
    expect(DEFECT_TRANSITIONS.resolved).toContain("verified");
    expect(DEFECT_TRANSITIONS.verified).toContain("closed");
  });

  it("resolved -> reopened -> in_progress is allowed", () => {
    expect(DEFECT_TRANSITIONS.resolved).toContain("reopened");
    expect(DEFECT_TRANSITIONS.reopened).toContain("in_progress");
  });

  it("wont_fix and duplicate are terminal", () => {
    expect(DEFECT_TRANSITIONS.wont_fix).toEqual([]);
    expect(DEFECT_TRANSITIONS.duplicate).toEqual([]);
  });

  it("rejects illegal transitions with an InvalidTransition error carrying allowed list", () => {
    try {
      validateDefectTransition({ fromStatus: "verified", toStatus: "resolved" });
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const app = e as AppError;
      expect(app.code).toBe("InvalidTransition");
      expect(app.status).toBe(409);
      expect(app.details).toEqual({
        from: "verified",
        to: "resolved",
        allowed: DEFECT_TRANSITIONS.verified,
      });
    }
  });

  it("a no-op transition (same status) is always allowed", () => {
    expect(() => validateDefectTransition({ fromStatus: "new", toStatus: "new" })).not.toThrow();
    expect(() => validateDefectTransition({ fromStatus: "closed", toStatus: "closed" })).not.toThrow();
  });

  it("marking duplicate without a duplicateOfId is a RuleViolation", () => {
    try {
      validateDefectTransition({ fromStatus: "new", toStatus: "duplicate" });
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as AppError).code).toBe("RuleViolation");
      expect((e as AppError).status).toBe(422);
    }
  });

  it("marking duplicate with duplicateOfId is allowed", () => {
    expect(() =>
      validateDefectTransition({ fromStatus: "new", toStatus: "duplicate", duplicateOfId: "some-defect-id" }),
    ).not.toThrow();
  });

  it("blocks self-verification when resolver is the actor (SelfVerificationForbidden 409)", () => {
    try {
      validateDefectTransition({
        fromStatus: "resolved",
        toStatus: "verified",
        resolverId: "user-a",
        actorId: "user-a",
      });
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as AppError).code).toBe("SelfVerificationForbidden");
      expect((e as AppError).status).toBe(409);
    }
  });

  it("allows verification by a different user", () => {
    expect(() =>
      validateDefectTransition({ fromStatus: "resolved", toStatus: "verified", resolverId: "user-a", actorId: "user-b" }),
    ).not.toThrow();
  });

  it("allows verification when there is no recorded resolver", () => {
    expect(() =>
      validateDefectTransition({ fromStatus: "resolved", toStatus: "verified", resolverId: null, actorId: "user-a" }),
    ).not.toThrow();
  });
});
