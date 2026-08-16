import type { Role } from "./types";

// Mirrors the server-side role matrix (§1). The UI uses this to hide/disable
// controls so a 403 is never reachable from an enabled control.
type Permission =
  | "manage_project"
  | "author_cases"
  | "plan_runs"
  | "execute_tests"
  | "ingest_results"
  | "triage_defects"
  | "comment_defects"
  | "quarantine_flaky"
  | "approve_gate"
  | "read";

const MATRIX: Record<Role, Record<Permission, boolean>> = {
  owner: {
    manage_project: true,
    author_cases: true,
    plan_runs: true,
    execute_tests: true,
    ingest_results: true,
    triage_defects: true,
    comment_defects: true,
    quarantine_flaky: true,
    approve_gate: true,
    read: true,
  },
  qa_lead: {
    manage_project: false,
    author_cases: true,
    plan_runs: true,
    execute_tests: true,
    ingest_results: true,
    triage_defects: true,
    comment_defects: true,
    quarantine_flaky: true,
    approve_gate: true,
    read: true,
  },
  tester: {
    manage_project: false,
    author_cases: true,
    plan_runs: false,
    execute_tests: true,
    ingest_results: true,
    triage_defects: true,
    comment_defects: true,
    quarantine_flaky: false,
    approve_gate: false,
    read: true,
  },
  developer: {
    manage_project: false,
    author_cases: false,
    plan_runs: false,
    execute_tests: false,
    ingest_results: true,
    triage_defects: false,
    comment_defects: true,
    quarantine_flaky: false,
    approve_gate: false,
    read: true,
  },
  viewer: {
    manage_project: false,
    author_cases: false,
    plan_runs: false,
    execute_tests: false,
    ingest_results: false,
    triage_defects: false,
    comment_defects: false,
    quarantine_flaky: false,
    approve_gate: false,
    read: true,
  },
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.[permission] ?? false;
}

export const roleLabels: Record<Role, string> = {
  owner: "Owner",
  qa_lead: "QA Lead",
  tester: "Tester",
  developer: "Developer",
  viewer: "Viewer",
};

export { MATRIX };
