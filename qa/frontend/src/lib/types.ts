// Domain types mirroring the §7 API contract and §2 domain model.
// Field names match the backend's JSON exactly.

export type Role =
  | "owner"
  | "qa_lead"
  | "tester"
  | "developer"
  | "viewer";

export type CasePriority = "low" | "medium" | "high" | "critical";
export type CaseType =
  | "functional"
  | "regression"
  | "smoke"
  | "integration"
  | "e2e"
  | "performance"
  | "security";
export type AutomationStatus = "manual" | "automated" | "candidate";
export type RequirementCriticality = "low" | "medium" | "high" | "critical";
export type RequirementStatus = "draft" | "active" | "deprecated";
export type RunStatus =
  | "planned"
  | "in_progress"
  | "paused"
  | "completed"
  | "aborted";
export type ExecutionStatus =
  | "untested"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "retest";
export type DefectSeverity =
  | "trivial"
  | "minor"
  | "major"
  | "critical"
  | "blocker";
export type DefectPriority = "low" | "medium" | "high" | "urgent";
export type DefectStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "verified"
  | "closed"
  | "reopened"
  | "wont_fix"
  | "duplicate";
export type ReleaseStatus =
  | "planning"
  | "testing"
  | "gated"
  | "released"
  | "cancelled";
export type FlakyVerdict = "stable" | "suspect" | "flaky";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  last_login_at?: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  default_environment_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  settings_json?: ProjectSettings | null;
}

export interface ProjectSettings {
  riskWeights?: {
    requirementCriticality: number;
    recentFailureRate: number;
    recencyOfCodeChange: number;
    casePriority: number;
    flakePenalty: number;
  };
}

export interface ProjectMember {
  user_id: string;
  project_role: Role;
  full_name?: string;
  email?: string;
  role?: Role;
}

export interface Requirement {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  description?: string | null;
  criticality: RequirementCriticality;
  status: RequirementStatus;
  created_at: string;
}

export interface CaseStep {
  index: number;
  action: string;
  expected: string;
}

export interface TestCase {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  current_version: number;
  folder_path: string;
  priority: CasePriority;
  type: CaseType;
  automation_status: AutomationStatus;
  automation_key?: string | null;
  owner_id?: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  version?: TestCaseVersion | null;
  versions?: TestCaseVersion[];
  requirements?: Requirement[];
}

export interface TestCaseVersion {
  id: string;
  test_case_id: string;
  version: number;
  title: string;
  preconditions?: string | null;
  steps_json: CaseStep[];
  expected_result?: string | null;
  tags: string[];
  estimated_minutes?: number | null;
  authored_by?: string | null;
  change_note?: string | null;
  created_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Suite {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  filter_json?: SuiteFilter | null;
  case_count?: number;
  created_at?: string;
}

export interface SuiteFilter {
  folder?: string;
  tag?: string;
  type?: CaseType | null;
  priority?: CasePriority | null;
  automation_status?: AutomationStatus | null;
  q?: string;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  base_url?: string | null;
  notes?: string | null;
}

export interface Build {
  id: string;
  project_id: string;
  version_label: string;
  commit_sha?: string | null;
  branch?: string | null;
  ci_url?: string | null;
  created_at: string;
}

export interface GatePolicy {
  minPassRate?: number;
  maxOpenBlockers?: number;
  maxOpenCritical?: number;
  minRequirementCoverage?: number;
  maxFlakyInSuite?: number;
  requiredSuites?: string[];
  maxOpenDefectsBySeverity?: Record<string, number>;
}

export interface GateCriterion {
  key: string;
  required: number;
  actual: number;
  passed: boolean;
  waived?: boolean;
  evidence: {
    [k: string]: unknown;
  };
}

export interface GateResult {
  verdict: "pass" | "fail" | "waived";
  evaluatedAt?: string;
  buildId?: string;
  criteria: GateCriterion[];
  blocking: string[];
  policyHash?: string;
  override?: {
    by: string;
    byName?: string;
    reason: string;
    at: string;
  } | null;
}

export interface Release {
  id: string;
  project_id: string;
  name: string;
  target_build_id?: string | null;
  planned_date?: string | null;
  status: ReleaseStatus;
  gate_policy_json?: GatePolicy | null;
  gate_result_json?: GateResult | null;
  gate_decided_by?: string | null;
  gate_decided_at?: string | null;
  created_at: string;
}

export interface TestPlan {
  id: string;
  project_id: string;
  release_id?: string | null;
  name: string;
  description?: string | null;
  status: "draft" | "active" | "closed";
  created_by?: string | null;
  created_at: string;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  untested: number;
  retest: number;
}

export interface TestRun {
  id: string;
  project_id: string;
  plan_id?: string | null;
  suite_id?: string | null;
  build_id?: string | null;
  environment_id: string;
  name: string;
  source: "manual" | "ci";
  status: RunStatus;
  started_at?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  stats_json?: RunStats | null;
  created_at: string;
  build?: Build | null;
  environment?: Environment | null;
}

export interface StepResult {
  index: number;
  action: string;
  expected: string;
  status: ExecutionStatus;
  comment?: string | null;
}

export interface TestExecution {
  id: string;
  run_id: string;
  test_case_id: string;
  case_version_id: string;
  assigned_to?: string | null;
  status: ExecutionStatus;
  duration_ms?: number | null;
  executed_by?: string | null;
  executed_at?: string | null;
  comment?: string | null;
  step_results_json?: StepResult[] | null;
  automation_ref?: string | null;
  failure_signature?: string | null;
  attempt: number;
  test_case?: TestCase | null;
}

export interface Attachment {
  id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by?: string | null;
  created_at: string;
}

export interface Defect {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  description?: string | null;
  severity: DefectSeverity;
  priority: DefectPriority;
  status: DefectStatus;
  resolution?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  found_in_build_id?: string | null;
  fixed_in_build_id?: string | null;
  duplicate_of_id?: string | null;
  environment_id?: string | null;
  sla_due_at?: string | null;
  first_seen_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  escaped_to_prod: boolean;
  created_at: string;
  updated_at: string;
  events?: DefectEvent[];
  executions?: TestExecution[];
  attachments?: Attachment[];
  reporter_name?: string | null;
  assignee_name?: string | null;
  found_in_build?: string | null;
}

export interface DefectEvent {
  id: string;
  defect_id: string;
  actor_id?: string | null;
  from_status?: string | null;
  to_status: string;
  field_changes_json?: Record<string, unknown> | null;
  comment?: string | null;
  created_at: string;
  actor_name?: string | null;
}

export interface FlakySignal {
  id: string;
  test_case_id: string;
  window_start: string;
  window_end: string;
  total_runs: number;
  transitions: number;
  flake_score: number;
  verdict: FlakyVerdict;
  computed_at: string;
  test_case?: TestCase | null;
  timeline?: FlakyTimelinePoint[];
  quarantined?: boolean;
}

export interface FlakyTimelinePoint {
  build_label: string;
  commit_sha?: string | null;
  status: ExecutionStatus;
  executed_at?: string | null;
}

export interface Quarantine {
  id: string;
  test_case_id: string;
  reason?: string | null;
  quarantined_by?: string | null;
  quarantined_at?: string | null;
  released_at?: string | null;
  linked_defect_id?: string | null;
}

export interface FailureCluster {
  signature: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  sample_error: string;
  execution_ids: string[];
  test_case_refs: string[];
}

export interface TraceabilityCell {
  requirement_id: string;
  status: "covered_passing" | "covered_failing" | "covered_untested" | "uncovered";
  case_refs: string[];
}

export interface TraceabilityMatrix {
  build_id: string;
  requirements: Requirement[];
  cases: Array<{ id: string; ref: string; title: string }>;
  cells: Record<string, TraceabilityCell>;
  gaps: Array<{ requirement: Requirement; caseCount: number }>;
  coveragePct: number;
}

export interface Metrics {
  passRateTrend: Array<{ build_label: string; pass_rate: number; executed: number }>;
  defectDensity: number;
  meanTimeToDetectHours: number;
  meanTimeToResolveHours: number;
  reopenRate: number;
  escapeRate: number;
  openDefectsBySeverity: Record<string, number>;
  burnDown: Array<{ day: string; remaining: number }>;
  flakiestCases: Array<{ test_case_ref: string; title: string; flake_score: number }>;
  recentActivity: Array<{
    id: string;
    kind: string;
    summary: string;
    actor?: string | null;
    created_at: string;
  }>;
  coveragePct: number;
  coverageGaps: Array<{ ref: string; title: string; criticality: string }>;
}

export interface SuggestedOrderItem {
  test_case_id: string;
  ref: string;
  title: string;
  risk_score: number;
  factors: Record<string, number>;
}

export interface IngestionBatch {
  id: string;
  project_id: string;
  build_id?: string | null;
  run_id?: string | null;
  format: "junit" | "xunit" | "trx" | "allure_json";
  raw_size_bytes: number;
  parsed_count: number;
  matched_count: number;
  unmatched_count: number;
  unmatched_json?: unknown;
  status: string;
  error_message?: string | null;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret?: string | null;
}

export interface AuditLogEntry {
  id: string;
  actor_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata_json?: Record<string, unknown> | null;
  ip?: string | null;
  created_at: string;
  actor_name?: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at?: string | null;
  revoked_at?: string | null;
  created_by?: string | null;
  created_at: string;
  plaintext?: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  status: number;
}

export interface CaseHistory {
  executions: Array<{
    id: string;
    run_id: string;
    run_name?: string;
    build_label?: string | null;
    status: ExecutionStatus;
    executed_at?: string | null;
    duration_ms?: number | null;
    executed_by?: string | null;
    attempt: number;
  }>;
  flake: Array<{
    build_label: string;
    pass_rate: number;
    count: number;
  }>;
  flake_score: number;
  verdict: FlakyVerdict;
}
