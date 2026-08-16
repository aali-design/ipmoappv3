-- SCHOLARION schema.sql
-- Every column any query reads must be declared here with a compatible type.
-- Money is integer minor units (bigint). Enums are varchar with CHECK constraints.

CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================ Core & people
CREATE TABLE IF NOT EXISTS schools (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  timezone      text NOT NULL DEFAULT 'UTC',
  currency      char(3) NOT NULL DEFAULT 'USD',
  locale        text NOT NULL DEFAULT 'en',
  address       text,
  logo_url      text,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          varchar(16) NOT NULL CHECK (role IN ('admin','registrar','accountant','teacher','student','guardian')),
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);

CREATE TABLE IF NOT EXISTS students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  admission_no  varchar(24) NOT NULL,
  user_id       uuid REFERENCES users(id),
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  date_of_birth date,
  gender        varchar(12),
  nationality   text,
  photo_url     text,
  status        varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('applicant','active','suspended','graduated','withdrawn','transferred')),
  admitted_on   date,
  exited_on     date,
  exit_reason   text,
  medical_notes text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_no)
);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);

CREATE TABLE IF NOT EXISTS guardians (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id),
  full_name  text NOT NULL,
  relation   varchar(16),
  phone      text,
  email      citext,
  occupation text,
  address    text
);
CREATE INDEX IF NOT EXISTS idx_guardians_school ON guardians(school_id);

CREATE TABLE IF NOT EXISTS guardianships (
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id       uuid NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  is_primary        boolean NOT NULL DEFAULT false,
  is_billing_contact boolean NOT NULL DEFAULT false,
  can_pickup        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (student_id, guardian_id)
);
CREATE INDEX IF NOT EXISTS idx_guardianships_guardian ON guardianships(guardian_id);

CREATE TABLE IF NOT EXISTS staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id),
  employee_no  varchar(24) NOT NULL,
  full_name    text NOT NULL,
  designation  text,
  department   text,
  hired_on     date,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (school_id, employee_no)
);
CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school_id);

-- ============================================================ Academic structure
CREATE TABLE IF NOT EXISTS academic_years (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  status     varchar(12) NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','closed')),
  UNIQUE (school_id, name)
);
-- at most one is_current per school
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_one_current
  ON academic_years(school_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS terms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name            text NOT NULL,
  sequence        int NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  status          varchar(12) NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','locked')),
  UNIQUE (academic_year_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_terms_year ON terms(academic_year_id);

CREATE TABLE IF NOT EXISTS grade_levels (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  sequence  int NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_levels_school ON grade_levels(school_id);

CREATE TABLE IF NOT EXISTS sections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id    uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_level_id      uuid NOT NULL REFERENCES grade_levels(id),
  name                text NOT NULL,
  capacity            int NOT NULL,
  homeroom_teacher_id uuid REFERENCES staff(id),
  UNIQUE (academic_year_id, grade_level_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sections_year ON sections(academic_year_id);

CREATE TABLE IF NOT EXISTS subjects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  is_elective  boolean NOT NULL DEFAULT false,
  credit_hours numeric(3,1) NOT NULL DEFAULT 1,
  UNIQUE (school_id, code)
);
CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);

CREATE TABLE IF NOT EXISTS grade_subjects (
  grade_level_id uuid NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  is_mandatory   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (grade_level_id, subject_id)
);

CREATE TABLE IF NOT EXISTS teaching_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id      uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id      uuid NOT NULL REFERENCES staff(id),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  UNIQUE (section_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_teacher ON teaching_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teaching_assignments_year ON teaching_assignments(academic_year_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  section_id      uuid NOT NULL REFERENCES sections(id),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  enrolled_on     date NOT NULL,
  left_on         date,
  roll_no         int,
  status          varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','transferred','withdrawn','promoted','repeated'))
);
-- at most one active enrollment per student per academic year
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollments_one_active
  ON enrollments(student_id, academic_year_id) WHERE (left_on IS NULL);
CREATE INDEX IF NOT EXISTS idx_enrollments_section ON enrollments(section_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_year ON enrollments(academic_year_id);

CREATE TABLE IF NOT EXISTS rooms (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  capacity  int,
  kind      varchar(16) NOT NULL DEFAULT 'classroom' CHECK (kind IN ('classroom','lab','gym','hall'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_school ON rooms(school_id);

-- ============================================================ Timetable & attendance
CREATE TABLE IF NOT EXISTS periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  sequence        int NOT NULL,
  label           text NOT NULL,
  starts_at       time NOT NULL,
  ends_at         time NOT NULL,
  is_break        boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_periods_year ON periods(academic_year_id);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  section_id      uuid NOT NULL REFERENCES sections(id),
  subject_id      uuid NOT NULL REFERENCES subjects(id),
  teacher_id      uuid NOT NULL REFERENCES staff(id),
  room_id         uuid REFERENCES rooms(id),
  weekday         int NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  period_id       uuid NOT NULL REFERENCES periods(id),
  effective_from  date NOT NULL,
  effective_to    date,
  UNIQUE (section_id, weekday, period_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher ON timetable_slots(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_room ON timetable_slots(room_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_section ON timetable_slots(section_id);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_slot_id uuid REFERENCES timetable_slots(id),
  section_id        uuid NOT NULL REFERENCES sections(id),
  subject_id        uuid REFERENCES subjects(id),
  date              date NOT NULL,
  period_id         uuid REFERENCES periods(id),
  taken_by          uuid REFERENCES users(id),
  taken_at          timestamptz NOT NULL DEFAULT now(),
  is_finalized      boolean NOT NULL DEFAULT false,
  UNIQUE (section_id, date, period_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(date);

CREATE TABLE IF NOT EXISTS attendance_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES students(id),
  status       varchar(12) NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','excused','sick')),
  minutes_late int NOT NULL DEFAULT 0,
  remark       text,
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_id);

-- ============================================================ Assessment & grading
CREATE TABLE IF NOT EXISTS grading_scales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       text NOT NULL,
  bands_json jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_grading_scales_school ON grading_scales(school_id);

CREATE TABLE IF NOT EXISTS assessment_categories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id      uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  weight_pct            numeric(5,2) NOT NULL,
  drop_lowest           int NOT NULL DEFAULT 0,
  applies_to_subject_id uuid REFERENCES subjects(id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_categories_year ON assessment_categories(academic_year_id);

CREATE TABLE IF NOT EXISTS assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id             uuid NOT NULL REFERENCES terms(id),
  section_id          uuid NOT NULL REFERENCES sections(id),
  subject_id          uuid NOT NULL REFERENCES subjects(id),
  category_id         uuid REFERENCES assessment_categories(id),
  title               text NOT NULL,
  max_score           numeric(6,2) NOT NULL,
  weight_override_pct numeric(5,2),
  due_on              date,
  is_published        boolean NOT NULL DEFAULT false,
  created_by          uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_assessments_section ON assessments(section_id);
CREATE INDEX IF NOT EXISTS idx_assessments_term ON assessments(term_id);

CREATE TABLE IF NOT EXISTS marks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES students(id),
  score        numeric(6,2),
  is_absent    boolean NOT NULL DEFAULT false,
  is_excused   boolean NOT NULL DEFAULT false,
  remark       text,
  entered_by   uuid REFERENCES users(id),
  entered_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);

CREATE TABLE IF NOT EXISTS report_cards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES students(id),
  term_id            uuid NOT NULL REFERENCES terms(id),
  enrollment_id      uuid NOT NULL REFERENCES enrollments(id),
  status             varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','published')),
  snapshot_json      jsonb,
  snapshot_hash      char(64),
  overall_percentage numeric(5,2),
  gpa                numeric(4,2),
  class_rank         int,
  class_size         int,
  attendance_pct     numeric(5,2),
  homeroom_comment   text,
  published_at       timestamptz,
  published_by       uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (student_id, term_id, version)
);
CREATE INDEX IF NOT EXISTS idx_report_cards_student ON report_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_term ON report_cards(term_id);

CREATE TABLE IF NOT EXISTS promotion_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES students(id),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  decision         varchar(12) NOT NULL DEFAULT 'pending' CHECK (decision IN ('promoted','repeated','graduated','pending')),
  to_grade_level_id uuid REFERENCES grade_levels(id),
  reason           text,
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_promotion_decisions_student ON promotion_decisions(student_id);

-- ============================================================ Fees & money (bigint minor units)
CREATE TABLE IF NOT EXISTS fee_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_level_id  uuid REFERENCES grade_levels(id),
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_fee_structures_year ON fee_structures(academic_year_id);

CREATE TABLE IF NOT EXISTS fee_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id  uuid NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      varchar(16) NOT NULL DEFAULT 'tuition' CHECK (category IN ('tuition','transport','meals','activity','exam','uniform','other')),
  amount_minor  bigint NOT NULL,
  frequency     varchar(12) NOT NULL DEFAULT 'once' CHECK (frequency IN ('once','per_term','monthly')),
  is_optional   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_fee_items_structure ON fee_items(structure_id);

CREATE TABLE IF NOT EXISTS fee_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id),
  structure_id    uuid NOT NULL REFERENCES fee_structures(id),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  overrides_json  jsonb,
  assigned_on     date NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS idx_fee_assignments_student ON fee_assignments(student_id);

CREATE TABLE IF NOT EXISTS discounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name               text NOT NULL,
  kind               varchar(12) NOT NULL CHECK (kind IN ('percent','fixed')),
  value              numeric(7,2) NOT NULL,
  applies_to_category varchar(16),
  requires_approval  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_discounts_school ON discounts(school_id);

CREATE TABLE IF NOT EXISTS student_discounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id),
  discount_id     uuid NOT NULL REFERENCES discounts(id),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  status          varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  approved_by     uuid REFERENCES users(id),
  valid_from      date,
  valid_to        date
);
CREATE INDEX IF NOT EXISTS idx_student_discounts_student ON student_discounts(student_id);

CREATE TABLE IF NOT EXISTS invoice_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  term_id         uuid REFERENCES terms(id),
  criteria_json   jsonb,
  status          varchar(16),
  invoice_count   int NOT NULL DEFAULT 0,
  total_minor     bigint NOT NULL DEFAULT 0,
  run_by          uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES students(id),
  academic_year_id   uuid NOT NULL REFERENCES academic_years(id),
  term_id            uuid REFERENCES terms(id),
  number             varchar(24) NOT NULL,
  issue_date         date NOT NULL,
  due_date           date NOT NULL,
  subtotal_minor     bigint NOT NULL DEFAULT 0,
  discount_minor     bigint NOT NULL DEFAULT 0,
  late_fee_minor     bigint NOT NULL DEFAULT 0,
  total_minor        bigint NOT NULL DEFAULT 0,
  paid_minor         bigint NOT NULL DEFAULT 0,
  balance_minor      bigint NOT NULL DEFAULT 0,
  status             varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','overdue','void')),
  generation_batch_id uuid REFERENCES invoice_batches(id),
  idempotency_key    varchar(96) NOT NULL UNIQUE,
  voided_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student_status ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_school ON invoices(school_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fee_item_id       uuid REFERENCES fee_items(id),
  description       text NOT NULL,
  quantity          int NOT NULL DEFAULT 1,
  unit_amount_minor bigint NOT NULL,
  discount_minor    bigint NOT NULL DEFAULT 0,
  line_total_minor  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id),
  receipt_no varchar(24) NOT NULL,
  amount_minor bigint NOT NULL,
  method     varchar(16) NOT NULL CHECK (method IN ('cash','bank_transfer','card','cheque','online')),
  reference  text,
  received_on date NOT NULL,
  received_by uuid REFERENCES users(id),
  status     varchar(12) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','cleared','bounced','refunded')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id),
  amount_minor bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES students(id),
  entry_date         date NOT NULL,
  kind               varchar(16) NOT NULL CHECK (kind IN ('invoice','payment','discount','late_fee','refund','adjustment','void')),
  reference_type     text,
  reference_id       uuid,
  debit_minor        bigint NOT NULL DEFAULT 0,
  credit_minor       bigint NOT NULL DEFAULT 0,
  balance_after_minor bigint NOT NULL,
  memo               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_student ON ledger_entries(student_id, entry_date, id);

-- ============================================================ Communication & platform
CREATE TABLE IF NOT EXISTS announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL,
  audience_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_at   timestamptz,
  expires_at   timestamptz,
  created_by   uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_announcements_school ON announcements(school_id);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES students(id),
  date               date NOT NULL,
  category           varchar(16) NOT NULL CHECK (category IN ('behavior','merit','health','other')),
  severity           text,
  description        text NOT NULL,
  action_taken       text,
  reported_by        uuid REFERENCES users(id),
  guardian_notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_incidents_student ON incidents(student_id);

CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  filename     text NOT NULL,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  uploaded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_school ON documents(school_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id),
  actor_id      uuid,
  action        text NOT NULL,
  entity_type   text,
  entity_id     uuid,
  metadata_json jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_school ON audit_log(school_id, created_at DESC);