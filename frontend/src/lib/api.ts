/**
 * Typed domain API — thin, fully-typed wrappers over the generic `apiClient`.
 * Every screen calls these methods; no screen talks to `fetch` directly and no
 * screen fabricates data. Routes mirror the SCHOLARION backend contract (spec §8).
 *
 * The backend returns list resources as `{ items, total }` envelopes; those are
 * unwrapped here so screens always receive plain typed arrays.
 */
import client, { authApi, sessionStore } from './apiClient'
import type {
  AcademicYear,
  Announcement,
  Assessment,
  AssessmentCategory,
  AttendanceSession,
  AttendanceSessionWithRecords,
  AttendanceSummary,
  AttendanceWarning,
  AuditLogEntry,
  AuthResponse,
  DashboardSummary,
  Discount,
  DocumentRecord,
  Enrollment,
  FeesSummary,
  FeeItem,
  FeeStructure,
  GradebookResponse,
  GradeLevel,
  GradesResponse,
  GradingScale,
  Guardian,
  HealthResponse,
  Incident,
  Invoice,
  InvoiceRunRequest,
  InvoiceRunResult,
  Paginated,
  Payment,
  Period,
  ReportCard,
  ReportCardGenerationResult,
  Room,
  Role,
  School,
  Section,
  Staff,
  Student,
  StudentDiscount,
  StudentLedger,
  StudentProfile,
  Subject,
  SuggestedSlot,
  Term,
  TimetableSlot,
  TimetableValidationResult,
  User,
} from './types'

interface ListParams {
  [key: string]: string | number | boolean | null | undefined
}

interface ListResponse<T> {
  items: T[]
  total: number
}

/** Unwrap a `{ items, total }` envelope into its `items` array. */
function itemsOf<T>(promise: Promise<ListResponse<T>>): Promise<T[]> {
  return promise.then((r) => r.items)
}

export interface MeResponse extends User {
  scope: { studentIds?: string[]; staffId?: string }
}

/** Flat slot row as returned by the teacher/student timetable endpoints. */
interface TimetableItemRow {
  id: string
  section_id: string
  subject_id: string
  teacher_id: string
  room_id: string | null
  weekday: number
  period_id: string
  effective_from: string
  effective_to?: string | null
  subject_name?: string
  subject_code?: string
  teacher_name?: string
  room_name?: string
  period_label?: string
  section_name?: string
}

/** Shape flat timetable rows into the nested `TimetableSlot` the grid expects. */
function normalizeSlot(r: TimetableItemRow): TimetableSlot {
  return {
    id: r.id,
    academic_year_id: '',
    section_id: r.section_id,
    subject_id: r.subject_id,
    teacher_id: r.teacher_id,
    room_id: r.room_id,
    weekday: Number(r.weekday),
    period_id: r.period_id,
    effective_from: r.effective_from,
    effective_to: r.effective_to ?? null,
    subject: r.subject_name
      ? { id: r.subject_id, school_id: '', code: r.subject_code ?? '', name: r.subject_name, is_elective: false, credit_hours: 1 }
      : undefined,
    teacher: r.teacher_name
      ? { id: r.teacher_id, school_id: '', employee_no: '', full_name: r.teacher_name, is_active: true }
      : undefined,
    room: r.room_name
      ? { id: r.room_id ?? '', school_id: '', name: r.room_name, capacity: 0, kind: 'classroom' as const }
      : undefined,
    section: r.section_name
      ? { id: r.section_id, academic_year_id: '', grade_level_id: '', name: r.section_name, capacity: 0 }
      : undefined,
  }
}

export const scholarionApi = {
  // ---- Auth ----
  login: (email: string, password: string): Promise<AuthResponse> =>
    client.post<AuthResponse>('/auth/login', { email, password }),
  logout: (): Promise<void> => authApi.logout(),
  me: (): Promise<MeResponse> => client.get<MeResponse>('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    client.post('/auth/change-password', body),
  forgotPassword: (email: string) => client.post('/auth/forgot-password', { email }),

  // ---- School setup ----
  getSchool: () => client.get<School>('/school'),
  patchSchool: (body: Partial<School>) => client.patch<School>('/school', body),

  academicYears: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<AcademicYear>>('/academic-years', { params })),
    create: (body: Partial<AcademicYear>) => client.post<AcademicYear>('/academic-years', body),
    patch: (id: string, body: Partial<AcademicYear>) => client.patch<AcademicYear>(`/academic-years/${id}`, body),
    activate: (id: string) => client.post(`/academic-years/${id}/activate`),
    close: (id: string) => client.post(`/academic-years/${id}/close`),
  },

  terms: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Term>>('/terms', { params })),
    create: (body: Partial<Term>) => client.post<Term>('/terms', body),
    patch: (id: string, body: Partial<Term>) => client.patch<Term>(`/terms/${id}`, body),
    lock: (id: string, body?: { reason?: string }) => client.post(`/terms/${id}/lock`, body),
  },

  gradeLevels: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<GradeLevel>>('/grade-levels', { params })),
    create: (body: Partial<GradeLevel>) => client.post<GradeLevel>('/grade-levels', body),
    patch: (id: string, body: Partial<GradeLevel>) => client.patch<GradeLevel>(`/grade-levels/${id}`, body),
  },

  sections: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Section>>('/sections', { params })),
    create: (body: Partial<Section>) => client.post<Section>('/sections', body),
    patch: (id: string, body: Partial<Section>) => client.patch<Section>(`/sections/${id}`, body),
    roster: (id: string) => itemsOf(client.get<ListResponse<Enrollment>>(`/sections/${id}/roster`)),
  },

  subjects: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Subject>>('/subjects', { params })),
    create: (body: Partial<Subject>) => client.post<Subject>('/subjects', body),
    patch: (id: string, body: Partial<Subject>) => client.patch<Subject>(`/subjects/${id}`, body),
  },

  rooms: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Room>>('/rooms', { params })),
    create: (body: Partial<Room>) => client.post<Room>('/rooms', body),
    patch: (id: string, body: Partial<Room>) => client.patch<Room>(`/rooms/${id}`, body),
  },

  periods: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Period>>('/periods', { params })),
    create: (body: Partial<Period>) => client.post<Period>('/periods', body),
    patch: (id: string, body: Partial<Period>) => client.patch<Period>(`/periods/${id}`, body),
  },

  gradingScales: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<GradingScale>>('/grading-scales', { params })),
    create: (body: Partial<GradingScale>) => client.post<GradingScale>('/grading-scales', body),
    patch: (id: string, body: Partial<GradingScale>) => client.patch<GradingScale>(`/grading-scales/${id}`, body),
  },

  assessmentCategories: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<AssessmentCategory>>('/assessment-categories', { params })),
    create: (body: Partial<AssessmentCategory>) => client.post<AssessmentCategory>('/assessment-categories', body),
    patch: (id: string, body: Partial<AssessmentCategory>) =>
      client.patch<AssessmentCategory>(`/assessment-categories/${id}`, body),
  },

  // ---- People ----
  students: {
    list: (params?: ListParams) => client.get<Paginated<Student>>('/students', { params }),
    create: (body: Partial<Student>) => client.post<Student>('/students', body),
    get: (id: string) => client.get<Student>(`/students/${id}`),
    patch: (id: string, body: Partial<Student>) => client.patch<Student>(`/students/${id}`, body),
    profile: (id: string) => client.get<StudentProfile>(`/students/${id}/profile`),
    addGuardians: (id: string, body: { guardianIds: string[]; isPrimary?: string }) =>
      client.post(`/students/${id}/guardians`, body),
  },

  guardians: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Guardian>>('/guardians', { params })),
    create: (body: Partial<Guardian>) => client.post<Guardian>('/guardians', body),
    patch: (id: string, body: Partial<Guardian>) => client.patch<Guardian>(`/guardians/${id}`, body),
  },

  staff: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Staff>>('/staff', { params })),
    create: (body: Partial<Staff>) => client.post<Staff>('/staff', body),
    patch: (id: string, body: Partial<Staff>) => client.patch<Staff>(`/staff/${id}`, body),
  },

  deactivateUser: (id: string) => client.post(`/users/${id}/deactivate`),

  // ---- Enrollment ----
  enrollments: {
    create: (body: { studentId: string; sectionId: string; academicYearId: string; allowOverflow?: boolean; reason?: string }) =>
      client.post<Enrollment>('/enrollments', body),
    transfer: (id: string, body: { toSectionId: string; reason?: string }) =>
      client.post<Enrollment>(`/enrollments/${id}/transfer`, body),
    bulkPromote: (body: { fromAcademicYearId: string; toAcademicYearId: string }) =>
      client.post('/enrollments/bulk-promote', body),
  },

  // ---- Timetable ----
  timetable: {
    list: (params?: ListParams) => client.get<TimetableSlot[]>('/timetable', { params }),
    createSlot: (body: Partial<TimetableSlot>) => client.post<TimetableSlot>('/timetable/slots', body),
    validate: (body: Partial<TimetableSlot> | Partial<TimetableSlot>[]) =>
      client.post<TimetableValidationResult>('/timetable/validate', body),
    suggestedSlots: (params: { sectionId: string; subjectId: string; teacherId: string }) =>
      client.get<SuggestedSlot[]>('/timetable/suggest', { params }),
    teacherTimetable: (teacherId: string) =>
      client.get<ListResponse<TimetableItemRow>>(`/teachers/${teacherId}/timetable`).then((r) => r.items.map(normalizeSlot)),
    studentTimetable: (studentId: string) =>
      client.get<ListResponse<TimetableItemRow>>(`/students/${studentId}/timetable`).then((r) => r.items.map(normalizeSlot)),
  },

  // ---- Attendance ----
  attendance: {
    createSession: (body: { sectionId: string; date: string; periodId?: string; subjectId?: string }) =>
      client.post<AttendanceSession>('/attendance/sessions', body),
    getSession: (id: string) => client.get<AttendanceSessionWithRecords>(`/attendance/sessions/${id}`),
    putRecords: (id: string, records: { studentId: string; status: string; minutesLate?: number; remark?: string }[]) =>
      client.put(`/attendance/sessions/${id}/records`, { records }),
    finalize: (id: string, body?: { reason?: string }) => client.post(`/attendance/sessions/${id}/finalize`, body),
    summary: (params: { scope: string; sectionId?: string; studentId?: string; termId?: string }) =>
      itemsOf(client.get<ListResponse<AttendanceSummary>>('/attendance/summary', { params })),
    warnings: (params?: { termId?: string }) =>
      itemsOf(client.get<ListResponse<AttendanceWarning>>('/attendance/warnings', { params })),
  },

  // ---- Assessment / grading ----
  assessments: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Assessment>>('/assessments', { params })),
    create: (body: Partial<Assessment>) => client.post<Assessment>('/assessments', body),
    patch: (id: string, body: Partial<Assessment>) => client.patch<Assessment>(`/assessments/${id}`, body),
    putMarks: (id: string, marks: { studentId: string; score?: number | null; isAbsent?: boolean; isExcused?: boolean; remark?: string }[]) =>
      client.put(`/assessments/${id}/marks`, { marks }),
  },

  gradebook: (params: { sectionId: string; subjectId: string; termId: string }) =>
    client.get<GradebookResponse>(`/sections/${params.sectionId}/gradebook`, {
      params: { subjectId: params.subjectId, termId: params.termId },
    }),

  grades: (studentId: string, params: { termId: string }) =>
    client.get<GradesResponse>(`/students/${studentId}/grades`, { params }),

  // ---- Report cards ----
  reportCards: {
    generate: (body: { termId: string; sectionId: string }) =>
      client.post<ReportCardGenerationResult>('/report-cards/generate', body),
    get: (id: string) => client.get<ReportCard>(`/report-cards/${id}`),
    submit: (id: string) => client.post<{ ok: boolean }>(`/report-cards/${id}/submit`),
    publish: (id: string) => client.post<ReportCard>(`/report-cards/${id}/publish`),
    revise: (id: string, body: { reason: string }) => client.post<ReportCard>(`/report-cards/${id}/revise`, body),
    studentList: (studentId: string) =>
      itemsOf(client.get<ListResponse<ReportCard>>(`/students/${studentId}/report-cards`)),
  },

  // ---- Fees ----
  feeStructures: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<FeeStructure>>('/fee-structures', { params })),
    create: (body: Partial<FeeStructure>) => client.post<FeeStructure>('/fee-structures', body),
    addItem: (id: string, body: Partial<FeeItem>) => client.post<FeeItem>(`/fee-structures/${id}/items`, body),
  },

  feeAssignments: {
    create: (body: { studentId: string; structureId: string; academicYearId: string; overrides?: Record<string, unknown> }) =>
      client.post('/fee-assignments', body),
  },

  discounts: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Discount>>('/discounts', { params })),
    create: (body: Partial<Discount>) => client.post<Discount>('/discounts', body),
  },

  studentDiscounts: {
    create: (body: { studentId: string; discountId: string; academicYearId: string }) =>
      client.post<StudentDiscount>('/student-discounts', body),
    decision: (id: string, body: { decision: 'approved' | 'rejected'; reason?: string }) =>
      client.post(`/student-discounts/${id}/decision`, body),
  },

  invoiceRuns: (body: InvoiceRunRequest) => client.post<InvoiceRunResult>('/fees/invoice-runs', body),

  invoices: {
    list: (params?: ListParams) => client.get<Paginated<Invoice>>('/invoices', { params }),
    get: (id: string) => client.get<Invoice>(`/invoices/${id}`),
    void: (id: string, body: { reason: string }) => client.post(`/invoices/${id}/void`, body),
  },

  payments: {
    create: (body: { studentId: string; amountMinor: number; method?: string; reference?: string; receivedOn?: string; allocations?: { invoiceId: string; amountMinor: number }[]; note?: string }) =>
      client.post<Payment>('/payments', body),
    receipt: (id: string) => client.get<Payment>(`/payments/${id}/receipt`),
  },

  ledger: (studentId: string) => client.get<StudentLedger>(`/students/${studentId}/ledger`),

  feesSummary: (params?: { academicYearId?: string }) => client.get<FeesSummary>('/fees/summary', { params }),

  // ---- Communication ----
  announcements: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Announcement>>('/announcements', { params })),
    create: (body: Partial<Announcement>) => client.post<Announcement>('/announcements', body),
    markRead: (id: string) => client.post(`/announcements/${id}/read`),
  },

  incidents: {
    list: (params?: ListParams) => itemsOf(client.get<ListResponse<Incident>>('/incidents', { params })),
    create: (body: Partial<Incident>) => client.post<Incident>('/incidents', body),
  },

  // ---- Documents ----
  documents: {
    upload: (formData: FormData) => client.post<DocumentRecord>('/documents', formData),
    downloadUrl: (id: string) => `/api/documents/${id}?token=${encodeURIComponent(sessionStore.current?.accessToken ?? '')}`,
  },

  // ---- Ops ----
  health: () => client.get<HealthResponse>('/health'),
  dashboard: () => client.get<DashboardSummary>('/dashboard/summary'),
  auditLog: (params?: ListParams) => client.get<Paginated<AuditLogEntry>>('/audit-log', { params }),
}

export type { Role }
