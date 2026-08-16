-- =====================================================================
-- QA — canonical schema declaration.
-- Idempotent: safe to run on every boot. Applied by the startup
-- migration runner (src/db/migrate.ts) before the server accepts traffic.
--
-- Note on `citext`: the `users.email` column is declared `citext` for
-- case-insensitive uniqueness. The migration runner issues
-- `CREATE EXTENSION IF NOT EXISTS citext` first. On engines without the
-- extension (e.g. the in-process PGlite used by integration tests) the
-- column degrades to `text` with an equivalent lower() unique index.
-- =====================================================================

-- ---------- tenants ----------
CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(160) NOT NULL,
  slug        varchar(160) NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           citext NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  full_name       varchar(160) NOT NULL,
  role            varchar(16) NOT NULL CHECK (role IN ('owner','qa_lead','tester','developer','viewer')),
  is_active       boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key                    varchar(10) NOT NULL,
  name                   varchar(160) NOT NULL,
  description            text,
  default_environment_id uuid,
  archived_at            timestamptz,
  settings_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_role  varchar(16) NOT NULL CHECK (project_role IN ('owner','qa_lead','tester','developer','viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  name            varchar(160) NOT NULL,
  key_prefix      varchar(12) NOT NULL,
  key_hash        text NOT NULL,
  scopes          text[] NOT NULL DEFAULT '{}',
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- requirements / cases ----------
CREATE TABLE IF NOT EXISTS requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref         varchar(24) NOT NULL,
  title       varchar(255) NOT NULL,
  description text,
  criticality varchar(8) NOT NULL CHECK (criticality IN ('low','medium','high','critical')) DEFAULT 'medium',
  status      varchar(12) NOT NULL CHECK (status IN ('draft','active','deprecated')) DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ref)
);

CREATE TABLE IF NOT EXISTS test_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref               varchar(24) NOT NULL,
  title             varchar(255) NOT NULL,
  current_version   integer NOT NULL DEFAULT 1,
  folder_path       varchar(256) NOT NULL DEFAULT '/',
  priority          varchar(8) NOT NULL CHECK (priority IN ('low','medium','high','critical')) DEFAULT 'medium',
  type              varchar(16) NOT NULL CHECK (type IN ('functional','regression','smoke','integration','e2e','performance','security')) DEFAULT 'functional',
  automation_status varchar(16) NOT NULL CHECK (automation_status IN ('manual','automated','candidate')) DEFAULT 'manual',
  automation_key    varchar(255),
  owner_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ref),
  UNIQUE (project_id, automation_key)
);

CREATE TABLE IF NOT EXISTS test_case_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id     uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  version          integer NOT NULL,
  title            varchar(255) NOT NULL,
  preconditions    text,
  steps_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_result  text,
  tags             text[] NOT NULL DEFAULT '{}',
  estimated_minutes integer,
  authored_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  change_note      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_case_id, version)
);

CREATE TABLE IF NOT EXISTS case_requirements (
  test_case_id   uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, requirement_id)
);

-- ---------- suites / plans / environments / builds ----------
CREATE TABLE IF NOT EXISTS test_suites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        varchar(160) NOT NULL,
  description text,
  filter_json jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suite_cases (
  suite_id    uuid NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (suite_id, test_case_id)
);

CREATE TABLE IF NOT EXISTS environments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        varchar(160) NOT NULL,
  base_url    varchar(255),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS builds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_label varchar(160) NOT NULL,
  commit_sha    varchar(40),
  branch        varchar(160),
  ci_url        varchar(255),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_label)
);

CREATE TABLE IF NOT EXISTS releases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             varchar(160) NOT NULL,
  target_build_id  uuid REFERENCES builds(id) ON DELETE SET NULL,
  planned_date     date,
  status           varchar(12) NOT NULL CHECK (status IN ('planning','testing','gated','released','cancelled')) DEFAULT 'planning',
  gate_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_result_json jsonb,
  gate_decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  gate_decided_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------- plans / runs / executions ----------
CREATE TABLE IF NOT EXISTS test_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_id  uuid REFERENCES releases(id) ON DELETE SET NULL,
  name        varchar(160) NOT NULL,
  description text,
  status      varchar(12) NOT NULL CHECK (status IN ('draft','active','closed')) DEFAULT 'draft',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id        uuid REFERENCES test_plans(id) ON DELETE SET NULL,
  suite_id       uuid REFERENCES test_suites(id) ON DELETE SET NULL,
  build_id       uuid REFERENCES builds(id) ON DELETE SET NULL,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  name           varchar(160) NOT NULL,
  source         varchar(12) NOT NULL CHECK (source IN ('manual','ci')) DEFAULT 'manual',
  status         varchar(12) NOT NULL CHECK (status IN ('planned','in_progress','paused','completed','aborted')) DEFAULT 'planned',
  started_at     timestamptz,
  completed_at   timestamptz,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  stats_json     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_executions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id      uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  case_version_id   uuid NOT NULL REFERENCES test_case_versions(id) ON DELETE RESTRICT,
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  status            varchar(12) NOT NULL CHECK (status IN ('untested','passed','failed','blocked','skipped','retest')) DEFAULT 'untested',
  duration_ms       integer,
  executed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  executed_at       timestamptz,
  comment           text,
  step_results_json jsonb,
  automation_ref    varchar(255),
  failure_signature char(64),
  attempt           integer NOT NULL DEFAULT 1,
  UNIQUE (run_id, test_case_id, attempt)
);

-- ---------- attachments / defects ----------
CREATE TABLE IF NOT EXISTS attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     varchar(24) NOT NULL,
  entity_id       uuid NOT NULL,
  filename        varchar(255) NOT NULL,
  content_type    varchar(128) NOT NULL,
  size_bytes      bigint NOT NULL DEFAULT 0,
  storage_path    text NOT NULL,
  uploaded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref               varchar(24) NOT NULL,
  title             varchar(255) NOT NULL,
  description       text,
  severity          varchar(8) NOT NULL CHECK (severity IN ('trivial','minor','major','critical','blocker')) DEFAULT 'major',
  priority          varchar(8) NOT NULL CHECK (priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
  status            varchar(16) NOT NULL CHECK (status IN ('new','triaged','in_progress','resolved','verified','closed','reopened','wont_fix','duplicate')) DEFAULT 'new',
  resolution        varchar(16),
  reported_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  found_in_build_id uuid REFERENCES builds(id) ON DELETE SET NULL,
  fixed_in_build_id uuid REFERENCES builds(id) ON DELETE SET NULL,
  duplicate_of_id   uuid REFERENCES defects(id) ON DELETE SET NULL,
  environment_id    uuid REFERENCES environments(id) ON DELETE SET NULL,
  sla_due_at        timestamptz,
  first_seen_at     timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  escaped_to_prod   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ref)
);

CREATE TABLE IF NOT EXISTS defect_links (
  defect_id    uuid NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES test_executions(id) ON DELETE CASCADE,
  PRIMARY KEY (defect_id, execution_id)
);

CREATE TABLE IF NOT EXISTS defect_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id         uuid NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  actor_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status       varchar(16),
  to_status         varchar(16),
  field_changes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- intelligence ----------
CREATE TABLE IF NOT EXISTS flaky_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  total_runs   integer NOT NULL DEFAULT 0,
  transitions  integer NOT NULL DEFAULT 0,
  flake_score  numeric(4,3) NOT NULL DEFAULT 0,
  verdict      varchar(12) NOT NULL CHECK (verdict IN ('stable','suspect','flaky')) DEFAULT 'stable',
  computed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quarantine (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id     uuid NOT NULL UNIQUE REFERENCES test_cases(id) ON DELETE CASCADE,
  reason           text NOT NULL,
  quarantined_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  quarantined_at   timestamptz NOT NULL DEFAULT now(),
  released_at      timestamptz,
  linked_defect_id uuid REFERENCES defects(id) ON DELETE SET NULL
);

-- ---------- ingestion ----------
CREATE TABLE IF NOT EXISTS ingestion_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id          uuid REFERENCES builds(id) ON DELETE SET NULL,
  run_id            uuid REFERENCES test_runs(id) ON DELETE SET NULL,
  format            varchar(16) NOT NULL CHECK (format IN ('junit','xunit','trx','allure_json')),
  raw_size_bytes    bigint NOT NULL DEFAULT 0,
  parsed_count      integer NOT NULL DEFAULT 0,
  matched_count     integer NOT NULL DEFAULT 0,
  unmatched_count   integer NOT NULL DEFAULT 0,
  unmatched_json    jsonb,
  status            varchar(16) NOT NULL DEFAULT 'pending',
  error_message     text,
  content_hash      text,
  created_by_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- webhooks ----------
CREATE TABLE IF NOT EXISTS webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url             text NOT NULL,
  secret          text,
  events          text[] NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           varchar(64) NOT NULL,
  payload_json    jsonb NOT NULL,
  attempt         integer NOT NULL DEFAULT 1,
  response_status integer,
  delivered_at    timestamptz,
  next_retry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- audit ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  action          varchar(64) NOT NULL,
  entity_type     varchar(64) NOT NULL,
  entity_id       uuid,
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip              varchar(64),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- migration bookkeeping ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Indexes (per spec §2; every FK is indexed)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_users_org ON users (organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys (project_id);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements (project_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_project ON test_cases (project_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_owner ON test_cases (owner_id);
CREATE INDEX IF NOT EXISTS idx_test_case_versions_case ON test_case_versions (test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_case_versions_authored ON test_case_versions (authored_by);
CREATE INDEX IF NOT EXISTS idx_case_requirements_req ON case_requirements (requirement_id);
CREATE INDEX IF NOT EXISTS idx_test_suites_project ON test_suites (project_id);
CREATE INDEX IF NOT EXISTS idx_suite_cases_case ON suite_cases (test_case_id);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments (project_id);
CREATE INDEX IF NOT EXISTS idx_builds_project ON builds (project_id);
CREATE INDEX IF NOT EXISTS idx_releases_project ON releases (project_id);
CREATE INDEX IF NOT EXISTS idx_releases_target_build ON releases (target_build_id);
CREATE INDEX IF NOT EXISTS idx_test_plans_project ON test_plans (project_id);
CREATE INDEX IF NOT EXISTS idx_test_plans_release ON test_plans (release_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_project ON test_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_plan ON test_runs (plan_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_suite ON test_runs (suite_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_build ON test_runs (build_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_env ON test_runs (environment_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs (project_id, status);
CREATE INDEX IF NOT EXISTS idx_test_executions_run_status ON test_executions (run_id, status);
CREATE INDEX IF NOT EXISTS idx_test_executions_case_exec ON test_executions (test_case_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_executions_case_version ON test_executions (case_version_id);
CREATE INDEX IF NOT EXISTS idx_test_executions_executed_by ON test_executions (executed_by);
CREATE INDEX IF NOT EXISTS idx_test_executions_signature ON test_executions (failure_signature);
CREATE INDEX IF NOT EXISTS idx_attachments_org ON attachments (organization_id);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_defects_project_status_sev ON defects (project_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_defects_reported_by ON defects (reported_by);
CREATE INDEX IF NOT EXISTS idx_defects_assigned_to ON defects (assigned_to);
CREATE INDEX IF NOT EXISTS idx_defects_duplicate_of ON defects (duplicate_of_id);
CREATE INDEX IF NOT EXISTS idx_defect_links_execution ON defect_links (execution_id);
CREATE INDEX IF NOT EXISTS idx_defect_events_defect ON defect_events (defect_id, created_at);
CREATE INDEX IF NOT EXISTS idx_flaky_signals_case ON flaky_signals (test_case_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_project ON ingestion_batches (project_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_build ON ingestion_batches (build_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks (organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log (organization_id, created_at DESC);
