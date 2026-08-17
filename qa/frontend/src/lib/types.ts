// Domain types mirroring the backend's actual JSON output.
// The backend serializes camelCase everywhere; these field names match the
// live API (see qa/backend/src/services/*.ts).

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
  fullName: string;
  role: Role;
  organizationId: string;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    organizationId: string;
  };
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

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  defaultEnvironmentId?: string | null;
  settings?: ProjectSettings | null;
  memberCount?: number;
  createdAt: string;
}

export interface ProjectMember {
  userId: string;
  email: string;
  fullName: string;
  projectRole: Role;
  globalRole: Role;
}

export interface Requirement {
  id: string;
  ref: string;
  title: string;
  description?: string | null;
  criticality: RequirementCriticality;
  status: RequirementStatus;
  createdAt: string;
}

export interface RequirementRef {
  id: string;
  ref: string;
  title: string;
  criticality: RequirementCriticality;
}

export interface CaseStep {
  index: number;
  action: string;
  expected: string;
}

export interface TestCase {
  id: string;
  ref: string;
  title: string;
  currentVersion: number;
  folderPath: string;
  priority: CasePriority;
  type: CaseType;
  automationStatus: AutomationStatus;
  automationKey?: string | null;
  ownerId?: string | null;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
  // detail-only fields (GET /cases/:id)
  steps?: CaseStep[];
  preconditions?: string | null;
  expectedResult?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  requirements?: RequirementRef[];
  versions?: TestCaseVersion[];
}

export interface TestCaseVersion {
  version: number;
  title: string;
  preconditions?: string | null;
  steps: CaseStep[];
  expectedResult?: string | null;
  tags: string[];
  estimatedMinutes?: number | null;
  authoredBy?: string | null;
  changeNote?: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Suite {
  id: string;
  name: string;
  description?: string | null;
  filter?: SuiteFilter | null;
  caseCount?: number;
  createdAt?: string;
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
  name: string;
  baseUrl?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface Build {
  id: string;
  projectId: string;
  versionLabel: string;
  commitSha?: string | null;
  branch?: string | null;
  ciUrl?: string | null;
  createdAt: string;
}

export interface GatePolicy {
  minPassRate?: number;
  maxOpenBlockers?: number;
  maxOpenCritical?: number;
  maxOpenDefects?: number;
  minRequirementCoverage?: number;
  maxFlakyInSuite?: number;
  requiredSuites?: string[];
  maxOpenDefectsBySeverity?: Record<string, number>;
}

export type GateValue = number | string | string[] | Record<string, number>;

export interface GateCriterion {
  key: string;
  required: GateValue;
  actual: GateValue;
  passed: boolean;
  waived?: boolean;
  evidence: Record<string, unknown>;
}

export interface GateResult {
  verdict: "pass" | "fail" | "waived";
  evaluatedAt?: string;
  buildId?: string;
  criteria: GateCriterion[];
  blocking: string[];
  policyHash?: string;
  waivedBy?: { id: string; name: string };
  waiverReason?: string;
  waivedAt?: string;
}

export interface Release {
  id: string;
  projectId: string;
  name: string;
  targetBuildId?: string | null;
  buildLabel?: string | null;
  plannedDate?: string | null;
  status: ReleaseStatus;
  gatePolicy?: GatePolicy | null;
  gateResult?: GateResult | null;
  gateDecidedBy?: string | null;
  gateDecidedAt?: string | null;
  createdAt: string;
}

export interface TestPlan {
  id: string;
  name: string;
  description?: string | null;
  status: "draft" | "active" | "closed";
  releaseId?: string | null;
  createdBy?: string | null;
  runCount?: number;
  createdAt: string;
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
  projectId: string;
  planId?: string | null;
  suiteId?: string | null;
  buildId?: string | null;
  buildLabel?: string | null;
  environmentId: string;
  environmentName: string;
  name: string;
  source: "manual" | "ci";
  status: RunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  createdBy?: string | null;
  stats?: RunStats | null;
  createdAt: string;
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
  runId: string;
  testCaseId: string;
  caseVersionId: string;
  caseRef: string;
  caseTitle: string;
  assignedTo?: string | null;
  status: ExecutionStatus;
  durationMs?: number | null;
  executedBy?: string | null;
  executedAt?: string | null;
  comment?: string | null;
  stepResults?: StepResult[] | null;
  automationRef?: string | null;
  failureSignature?: string | null;
  attempt: number;
}

export interface Attachment {
  id: string;
  entityType: string;
  entityId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: string | null;
  createdAt: string;
}

export interface Defect {
  id: string;
  ref: string;
  title: string;
  description?: string | null;
  severity: DefectSeverity;
  priority: DefectPriority;
  status: DefectStatus;
  resolution?: string | null;
  reportedBy?: string | null;
  reporterEmail?: string | null;
  assignedTo?: string | null;
  assigneeEmail?: string | null;
  foundInBuildId?: string | null;
  fixedInBuildId?: string | null;
  duplicateOfId?: string | null;
  environmentId?: string | null;
  slaDueAt?: string | null;
  firstSeenAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  escapedToProd: boolean;
  createdAt: string;
  updatedAt: string;
  events?: DefectEvent[];
  linkedExecutions?: LinkedExecution[];
}

export interface DefectEvent {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  fieldChanges?: Record<string, unknown> | null;
  comment?: string | null;
  createdAt: string;
}

export interface LinkedExecution {
  executionId: string;
  testCaseId: string;
  caseRef: string;
  status: ExecutionStatus;
  executedAt?: string | null;
}

export interface FlakySignal {
  testCaseId: string;
  ref: string;
  title: string;
  folderPath: string;
  flakeScore: number;
  verdict: FlakyVerdict;
  totalRuns: number;
  transitions: number;
  computedAt: string;
  quarantined: boolean;
  quarantineReason?: string | null;
}

export interface TraceabilityRequirement {
  id: string;
  ref: string;
  title: string;
  criticality: RequirementCriticality;
}

export interface TraceabilityCase {
  testCaseId: string;
  caseRef: string;
  caseTitle: string;
  status: ExecutionStatus;
}

export type RequirementStatus_Matrix =
  | "covered_passing"
  | "covered_failing"
  | "covered_untested"
  | "uncovered";

export interface TraceabilityRow {
  requirement: TraceabilityRequirement;
  status: RequirementStatus_Matrix;
  cases: TraceabilityCase[];
}

export interface TraceabilityMatrix {
  matrix: TraceabilityRow[];
  gaps: Array<{ id: string; ref: string; title: string; criticality: RequirementCriticality }>;
  coverage: number;
  totalRequirements: number;
  passingRequirements: number;
  buildId: string | null;
}

export interface PassRatePoint {
  build: string;
  buildId: string;
  passRate: number | null;
  passed: number;
  executed: number;
}

export interface Metrics {
  passRateTrend: PassRatePoint[];
  defectDensity: number;
  totalDefects: number;
  meanTimeToResolveSeconds: number | null;
  meanTimeToDetectSeconds: number | null;
  reopenRate: number;
  escapeRate: number;
  openDefectsBySeverity: Record<string, number>;
  activePlanBurnDown: Array<{
    runId: string;
    name: string;
    status: string;
    remaining: number;
    createdAt: string;
  }>;
  topFlakyCases: Array<{
    caseId: string;
    ref: string;
    title: string;
    flakeScore: number;
    verdict: FlakyVerdict;
  }>;
}

export interface SuggestedOrderItem {
  testCaseId: string;
  ref: string;
  title: string;
  folderPath: string;
  priority: CasePriority;
  riskScore: number;
  factors: Record<string, number>;
}

export interface SuggestedOrder {
  items: SuggestedOrderItem[];
  weights: Record<string, number>;
}

export interface FailureCluster {
  signature: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sampleError: string;
  executionIds: string[];
  caseRefs: string[];
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  projectId?: string | null;
  createdAt: string;
  key?: string;
}

export interface CaseHistory {
  caseId: string;
  timeline: Array<{
    executionId: string;
    runId: string;
    runName: string;
    build: string | null;
    commitSha: string | null;
    status: ExecutionStatus;
    executedAt: string | null;
    durationMs: number | null;
    comment: string | null;
    attempt: number;
  }>;
  flake: {
    score: number;
    verdict: FlakyVerdict;
    totalRuns: number;
    transitions: number;
  } | null;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  status: number;
}
