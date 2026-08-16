/**
 * Shared API types — mirror the SCHOLARION backend contract (spec §2, §8).
 * All money values are integer minor units (`*_minor` bigint).
 */

export type Role = 'admin' | 'registrar' | 'accountant' | 'teacher' | 'student' | 'guardian'

export type TermStatus = 'planning' | 'active' | 'locked'
export type YearStatus = 'planning' | 'active' | 'closed'
export type StudentStatus = 'applicant' | 'active' | 'suspended' | 'graduated' | 'withdrawn' | 'transferred'
export type EnrollmentStatus = 'active' | 'transferred' | 'withdrawn' | 'promoted' | 'repeated'
export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void'
export type PaymentStatus = 'recorded' | 'cleared' | 'bounced' | 'refunded'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'online'
export type FeeFrequency = 'once' | 'per_term' | 'monthly'
export type FeeItemCategory = 'tuition' | 'transport' | 'meals' | 'activity' | 'exam' | 'uniform' | 'other'
export type DiscountKind = 'percent' | 'fixed'
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'sick'
export type ReportCardStatus = 'draft' | 'submitted' | 'published'
export type IncidentCategory = 'behavior' | 'merit' | 'health' | 'other'

export interface ApiError {
  error: string
  message: string
  details?: Record<string, unknown> | unknown[]
}

export interface User {
  id: string
  school_id: string
  email: string
  full_name: string
  role: Role
  phone?: string | null
  is_active: boolean
  last_login_at?: string | null
}

export interface School {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  locale: string
  address?: string | null
  logo_url?: string | null
  settings_json: Record<string, unknown>
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
  scope: { studentIds?: string[] }
}

export interface Student {
  id: string
  school_id: string
  admission_no: string
  user_id?: string | null
  first_name: string
  last_name: string
  date_of_birth?: string | null
  gender?: string | null
  nationality?: string | null
  photo_url?: string | null
  status: StudentStatus
  admitted_on?: string | null
  exited_on?: string | null
  exit_reason?: string | null
  medical_notes?: string | null
  grade?: { id: string; name: string; sequence: number } | null
  section?: { id: string; name: string; grade_name?: string } | null
  academic_year?: { id: string; name: string } | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Guardian {
  id: string
  school_id: string
  user_id?: string | null
  full_name: string
  relation: string
  phone?: string | null
  email?: string | null
  occupation?: string | null
  address?: string | null
  students?: { id: string; full_name: string }[]
}

export interface Staff {
  id: string
  school_id: string
  user_id?: string | null
  employee_no: string
  full_name: string
  designation?: string | null
  department?: string | null
  hired_on?: string | null
  is_active: boolean
  user?: User | null
  settings_json?: Record<string, unknown>
}

export interface AcademicYear {
  id: string
  school_id: string
  name: string
  starts_on: string
  ends_on: string
  is_current: boolean
  status: YearStatus
}

export interface Term {
  id: string
  academic_year_id: string
  name: string
  sequence: number
  starts_on: string
  ends_on: string
  status: TermStatus
}

export interface GradeLevel {
  id: string
  school_id: string
  name: string
  sequence: number
}

export interface Section {
  id: string
  academic_year_id: string
  grade_level_id: string
  name: string
  capacity: number
  homeroom_teacher_id?: string | null
  grade_level?: { name: string; sequence: number }
  academic_year?: { name: string }
  homeroom_teacher?: { id: string; full_name: string } | null
  enrollment_count?: number
}

export interface Subject {
  id: string
  school_id: string
  code: string
  name: string
  is_elective: boolean
  credit_hours: number | string
}

export interface Room {
  id: string
  school_id: string
  name: string
  capacity: number
  kind: 'classroom' | 'lab' | 'gym' | 'hall'
}

export interface Period {
  id: string
  academic_year_id: string
  sequence: number
  label: string
  starts_at: string
  ends_at: string
  is_break: boolean
}

export interface TeachingAssignment {
  id: string
  section_id: string
  subject_id: string
  teacher_id: string
  academic_year_id: string
  section?: Section
  subject?: Subject
  teacher?: Staff
}

export interface Enrollment {
  id: string
  student_id: string
  section_id: string
  academic_year_id: string
  enrolled_on: string
  left_on?: string | null
  roll_no?: number | null
  status: EnrollmentStatus
  student?: Student
  section?: Section
  academic_year?: AcademicYear
}

export interface TimetableSlot {
  id: string
  academic_year_id: string
  section_id: string
  subject_id: string
  teacher_id: string
  room_id?: string | null
  weekday: number
  period_id: string
  effective_from: string
  effective_to?: string | null
  subject?: Subject
  teacher?: Staff
  section?: Section
  room?: Room
  period?: Period
}

export type ConflictSeverity = 'error' | 'warning'

export interface TimetableViolation {
  code: string
  severity: ConflictSeverity
  weekday: number
  periodId: string
  entities: Record<string, unknown>
  message: string
}

export interface TimetableValidationResult {
  valid: boolean
  violations: TimetableViolation[]
}

export interface TimetableGridCell {
  slot: TimetableSlot
  conflicts: TimetableViolation[]
}

/** Week grid grouped by weekday (1..7). */
export interface TimetableWeekGrid {
  academic_year_id: string
  weekdays: Record<number, TimetableGridCell[]>
}

export interface SuggestedSlot {
  weekday: number
  periodId: string
  period?: Period
  reason?: string
}

export interface AttendanceSession {
  id: string
  timetable_slot_id?: string | null
  section_id: string
  subject_id?: string | null
  date: string
  period_id?: string | null
  taken_by?: string | null
  taken_at?: string | null
  is_finalized: boolean
  section?: Section
  subject?: Subject
  period?: Period
}

export interface AttendanceRecord {
  id: string
  session_id: string
  student_id: string
  status: AttendanceStatus
  minutes_late?: number | null
  remark?: string | null
  student?: Student
}

export interface AttendanceSessionWithRecords {
  session: AttendanceSession
  records: AttendanceRecord[]
}

export interface AttendanceSummary {
  section_id?: string | null
  student_id?: string | null
  scope: string
  term_id?: string | null
  present: number
  absent: number
  late: number
  excused: number
  sick: number
  total: number
  percentage: number
  attendance_pct?: number
}

export interface AttendanceWarning {
  student_id: string
  student_name?: string
  section_id?: string
  term_id?: string
  attendance_pct: number
  consecutive_absences?: number
  warning_type: string
}

export interface GradingScaleBand {
  min: number
  max: number
  letter: string
  gpa: number
  remark: string
}

export interface GradingScale {
  id: string
  school_id: string
  name: string
  bands_json: GradingScaleBand[]
  is_default: boolean
}

export interface AssessmentCategory {
  id: string
  academic_year_id: string
  name: string
  weight_pct: number | string
  drop_lowest: number
  applies_to_subject_id?: string | null
}

export interface Assessment {
  id: string
  term_id: string
  section_id: string
  subject_id: string
  category_id: string
  title: string
  max_score: number | string
  weight_override_pct?: number | null
  due_on?: string | null
  is_published: boolean
  created_by?: string | null
  category?: AssessmentCategory
  subject?: Subject
  term?: Term
  section?: Section
}

export interface Mark {
  id: string
  assessment_id: string
  student_id: string
  score?: number | string | null
  is_absent: boolean
  is_excused: boolean
  remark?: string | null
  entered_by?: string | null
  entered_at?: string | null
  updated_at?: string | null
}

export interface GradebookRow {
  student_id: string
  student_name: string
  admission_no: string
  roll_no?: number | null
  marks: Record<string, Mark | null>
}

export interface GradebookResponse {
  assessments: Assessment[]
  rows: GradebookRow[]
  term_id: string
  subject_id: string
  section_id: string
}

export interface GradeTraceEntry {
  assessment_id: string
  assessment_title: string
  category: string
  category_weight_pct: number
  score: number | null
  max_score: number
  percentage: number | null
  is_dropped: boolean
  drop_reason?: string | null
  is_excused: boolean
  is_absent: boolean
  weight_applied_pct: number
}

export interface GradeTraceCategory {
  name: string
  weight_pct: number
  renormalized_weight_pct: number
  category_pct: number | null
  entries: GradeTraceEntry[]
}

export interface SubjectGrade {
  subject_id: string
  subject_name: string
  subject_code: string
  credit_hours: number
  percentage: number | null
  letter?: string | null
  gpa?: number | null
  weight_pct: number
  trace: GradeTraceCategory[]
}

export interface GradesResponse {
  term_id: string
  term_name?: string
  student_id: string
  overall_percentage: number | null
  overall_gpa: number | null
  letter?: string | null
  class_rank?: number | null
  class_size?: number | null
  subjects: SubjectGrade[]
}

export interface ReportCard {
  id: string
  student_id: string
  term_id: string
  enrollment_id: string
  status: ReportCardStatus
  snapshot_json: Record<string, unknown>
  snapshot_hash: string
  overall_percentage?: number | null
  gpa?: number | null
  class_rank?: number | null
  class_size?: number | null
  attendance_pct?: number | null
  homeroom_comment?: string | null
  published_at?: string | null
  published_by?: string | null
  version: number
  student?: Student
  term?: Term
  term_name?: string | null
}

export interface ReportCardGenerationResult {
  created: number
  skipped: number
}

export interface FeeStructure {
  id: string
  academic_year_id: string
  grade_level_id?: string | null
  name: string
  is_active: boolean
  items?: FeeItem[]
  grade_level?: GradeLevel
  academic_year?: AcademicYear
}

export interface FeeItem {
  id: string
  structure_id: string
  name: string
  category: FeeItemCategory
  amount_minor: number
  frequency: FeeFrequency
  is_optional: boolean
}

export interface Discount {
  id: string
  school_id: string
  name: string
  kind: DiscountKind
  value: number | string
  applies_to_category?: string | null
  requires_approval: boolean
}

export interface StudentDiscount {
  id: string
  student_id: string
  discount_id: string
  academic_year_id: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  approved_by?: string | null
  valid_from?: string | null
  valid_to?: string | null
  discount?: Discount
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  fee_item_id?: string | null
  description: string
  quantity: number
  unit_amount_minor: number
  discount_minor: number
  line_total_minor: number
}

export interface Invoice {
  id: string
  school_id: string
  student_id: string
  academic_year_id: string
  term_id?: string | null
  number: string
  issue_date: string
  due_date: string
  subtotal_minor: number
  discount_minor: number
  late_fee_minor: number
  total_minor: number
  paid_minor: number
  balance_minor: number
  status: InvoiceStatus
  generation_batch_id?: string | null
  idempotency_key: string
  voided_reason?: string | null
  created_at: string
  student?: Student
  lines?: InvoiceLine[]
  term?: Term
}

export interface PaymentAllocation {
  id: string
  payment_id: string
  invoice_id: string
  amount_minor: number
  invoice?: Invoice
}

export interface Payment {
  id: string
  school_id: string
  student_id: string
  receipt_no: string
  amount_minor: number
  method: PaymentMethod
  reference?: string | null
  received_on: string
  received_by?: string | null
  status: PaymentStatus
  note?: string | null
  created_at: string
  student?: Student
  allocations?: PaymentAllocation[]
}

export interface LedgerEntry {
  id: string
  school_id: string
  student_id: string
  entry_date: string
  kind: 'invoice' | 'payment' | 'discount' | 'late_fee' | 'refund' | 'adjustment' | 'void'
  reference_type?: string | null
  reference_id?: string | null
  debit_minor: number
  credit_minor: number
  balance_after_minor: number
  memo?: string | null
  created_at: string
}

export interface StudentLedger {
  items: LedgerEntry[]
  total_debit_minor: number
  total_credit_minor: number
  outstanding_minor: number
  reconciled: boolean
}

export interface InvoiceRunRequest {
  academicYearId: string
  termId?: string
  gradeLevelIds?: string[]
  dryRun?: boolean
}

export interface InvoiceRunResult {
  created: number
  skipped: number
  invoices?: Invoice[]
  totalMinor?: number
  dryRun?: boolean
}

export interface FeesSummary {
  billed_minor: number
  collected_minor: number
  outstanding_minor: number
  overdue_minor: number
  aging_buckets: { bucket: string; amount_minor: number }[]
  total_students?: number
}

export interface Announcement {
  id: string
  school_id: string
  title: string
  body: string
  audience_json: {
    roles?: Role[]
    grade_level_ids?: string[]
    section_ids?: string[]
    student_ids?: string[]
  }
  publish_at?: string | null
  expires_at?: string | null
  created_by?: string | null
  is_read?: boolean
  read_at?: string | null
}

export interface Incident {
  id: string
  student_id: string
  date: string
  category: IncidentCategory
  severity?: string | null
  description: string
  action_taken?: string | null
  reported_by?: string | null
  guardian_notified_at?: string | null
  student?: Student
}

export interface DocumentRecord {
  id: string
  school_id: string
  entity_type: string
  entity_id: string
  filename: string
  content_type: string
  size_bytes: number
  storage_path?: string | null
  uploaded_by?: string | null
  created_at: string
}

export interface AuditLogEntry {
  id: string
  school_id: string
  actor_id?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  metadata_json?: Record<string, unknown> | null
  ip?: string | null
  created_at: string
  actor?: { full_name: string; role: Role } | null
}

export interface DashboardSummary {
  enrolment_by_grade: { grade: string; count: number }[]
  today_attendance_pct: number | null
  attendance_today?: number | null
  fees_collected_minor: number
  fees_outstanding_minor: number
  overdue_invoices: number
  aging_buckets?: { bucket: string; amount_minor: number }[]
  upcoming_events: { title: string; date: string }[]
  recent_activity: { action: string; at: string; entity_type?: string }[]
  student_count: number
  staff_count?: number
}

export interface StudentProfile {
  student: Student
  enrollment?: Enrollment | null
  timetable?: TimetableWeekGrid | null
  attendance_pct?: number | null
  attendance?: AttendanceSummary | null
  grades?: GradesResponse | null
  fees_balance_minor?: number | null
  fees?: { outstanding_minor: number } | null
  incidents?: Incident[]
  documents?: DocumentRecord[]
  guardians?: Guardian[]
}

export interface WeekGridParams {
  sectionId?: string
  teacherId?: string
  roomId?: string
  studentId?: string
}

export interface PayIntent {
  student_id: string
  invoice_ids?: string[]
  amount_minor: number
  method?: string
  note?: string
}

export interface HealthResponse {
  status: string
  db: string
  version?: string
  uptimeSeconds?: number
}