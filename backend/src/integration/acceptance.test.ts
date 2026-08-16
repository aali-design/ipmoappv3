import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import pg from 'pg'
import { login, request } from './http.js'

/**
 * Acceptance integration suite (spec §11) over real HTTP + PostgreSQL.
 *
 * Bootstraps a throwaway `scholarion_test` database, applies migrations and the
 * demo seed, then drives the public API with `fetch` against an ephemeral port.
 * Run explicitly via `pnpm test:integration` (or as part of CI's DB-backed
 * `pnpm test` job) with DATABASE_URL pointing at a Postgres instance whose user
 * can CREATE DATABASE.
 */

const TEST_DB_NAME = 'scholarion_test'
const DEMO_PASSWORD = 'Password123!'

let baseUrl = ''
let adminToken = ''
let guardianToken = ''
let teacherToken = ''
let studentToken = ''

let pool: pg.Pool
let server: Server
let baseClient: pg.Client | null = null

// Fixtures discovered from the seed.
let academicYearId = ''
let term1Id = ''
let term2Id = ''
let primarySectionId = ''
let primaryStudentId = ''
let otherStudentId = ''
let engSubjectId = ''
let mthSubjectId = ''
let periodId = ''
let teacher1StaffId = ''
let teacher2StaffId = ''
let ownChildId = ''

// Fee-cluster fixtures shared with the late-fee test.
let feeStudentId = ''
let feeTerm2InvoiceId = ''

async function resetTestDatabase(): Promise<string> {
  const raw = process.env.DATABASE_URL ?? 'postgres://scholarion:scholarion@localhost:5432/scholarion'
  const parsed = new URL(raw)

  // If the target database is already the current one, drop/create through the
  // `postgres` maintenance database instead.
  const adminBase = new URL(parsed.toString())
  adminBase.pathname = parsed.pathname === `/${TEST_DB_NAME}` ? '/postgres' : parsed.pathname

  const base = new pg.Client({ connectionString: adminBase.toString(), connectionTimeoutMillis: 5000 })
  await base.connect()
  baseClient = base
  await base.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`)
  await base.query(`CREATE DATABASE ${TEST_DB_NAME}`)

  const testUrl = new URL(parsed.toString())
  testUrl.pathname = `/${TEST_DB_NAME}`
  return testUrl.toString()
}

beforeAll(async () => {
  const testDbUrl = await resetTestDatabase()
  process.env.DATABASE_URL = testDbUrl

  const { config } = await import('../config.js')
  const { runMigrations } = await import('../db/migrate.js')
  const { seedIfEmpty } = await import('../db/seed.js')
  const poolMod = await import('../db/pool.js')
  const { createApp } = await import('../app.js')
  pool = poolMod.pool

  await runMigrations()
  await seedIfEmpty()

  const app = createApp()
  server = app.listen(0)
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const adminLogin = await login(baseUrl, config.adminEmail, config.adminPassword)
  expect(adminLogin.status).toBe(200)
  adminToken = adminLogin.body.accessToken

  const guardianLogin = await login(baseUrl, 'guardian1@scholarion.local', DEMO_PASSWORD)
  guardianToken = guardianLogin.body.accessToken

  const teacherLogin = await login(baseUrl, 'teacher1@scholarion.local', DEMO_PASSWORD)
  teacherToken = teacherLogin.body.accessToken

  const studentLogin = await login(baseUrl, 'student1@scholarion.local', DEMO_PASSWORD)
  studentToken = studentLogin.body.accessToken

  const years = await request(baseUrl, 'GET', '/api/academic-years', { token: adminToken })
  academicYearId = years.body.items.find((y: any) => y.is_current).id

  const terms = await request(baseUrl, 'GET', `/api/terms?academicYearId=${academicYearId}`, { token: adminToken })
  term1Id = terms.body.items.find((t: any) => t.sequence === 1).id
  term2Id = terms.body.items.find((t: any) => t.sequence === 2).id

  const sections = await request(baseUrl, 'GET', `/api/sections?academicYearId=${academicYearId}`, { token: adminToken })
  primarySectionId = sections.body.items[0].id

  const roster = await request(baseUrl, 'GET', `/api/sections/${primarySectionId}/roster`, { token: adminToken })
  primaryStudentId = roster.body.items[0].student_id
  otherStudentId = roster.body.items[1].student_id

  const subjects = await request(baseUrl, 'GET', '/api/subjects', { token: adminToken })
  engSubjectId = subjects.body.items.find((s: any) => s.code === 'ENG').id
  mthSubjectId = subjects.body.items.find((s: any) => s.code === 'MTH').id

  const periods = await request(baseUrl, 'GET', `/api/periods?academicYearId=${academicYearId}`, { token: adminToken })
  periodId = periods.body.items.find((p: any) => !p.is_break).id

  const staff = await request(baseUrl, 'GET', '/api/staff', { token: adminToken })
  teacher1StaffId = staff.body.items.find((s: any) => s.email === 'teacher1@scholarion.local').id
  teacher2StaffId = staff.body.items.find((s: any) => s.email === 'teacher2@scholarion.local').id

  const guardianStudents = await request(baseUrl, 'GET', '/api/students?page=1&pageSize=20', { token: guardianToken })
  ownChildId = guardianStudents.body.items[0].id
}, 120_000)

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  if (pool) await pool.end().catch(() => undefined)
  if (baseClient) {
    await baseClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`).catch(() => undefined)
    await baseClient.end().catch(() => undefined)
  }
})

describe('§1 acceptance: health', () => {
  it('GET /api/health returns 200 with db up', async () => {
    const res = await request(baseUrl, 'GET', '/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.db).toBe('up')
  })
})

describe('§2 acceptance: admin login + session', () => {
  it('login returns 200 with accessToken and admin role', async () => {
    const res = await login(baseUrl, 'admin@scholarion.local', 'Admin12345!')
    expect(res.status).toBe(200)
    expect(typeof res.body.accessToken).toBe('string')
    expect(res.body.user.role).toBe('admin')
    expect(res.body.user.email).toBe('admin@scholarion.local')
  })

  it('GET /api/auth/me reflects the authenticated admin', async () => {
    const res = await request(baseUrl, 'GET', '/api/auth/me', { token: adminToken })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
  })

  it('refresh rotates the access token; logout revokes the refresh token', async () => {
    const loginRes = await login(baseUrl, 'admin@scholarion.local', 'Admin12345!')
    const refreshToken = loginRes.body.refreshToken

    const refreshRes = await request(baseUrl, 'POST', '/api/auth/refresh', { body: { refreshToken } })
    expect(refreshRes.status).toBe(200)
    expect(typeof refreshRes.body.accessToken).toBe('string')

    const logoutRes = await request(baseUrl, 'POST', '/api/auth/logout', { body: { refreshToken } })
    expect(logoutRes.status).toBe(204)

    const replay = await request(baseUrl, 'POST', '/api/auth/refresh', { body: { refreshToken } })
    expect(replay.status).toBe(401)
  })
})

describe('§3 acceptance: student list pagination', () => {
  it('returns total >= 120 with grade/section populated', async () => {
    const res = await request(baseUrl, 'GET', '/api/students?page=1&pageSize=20', { token: adminToken })
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThanOrEqual(120)
    expect(res.body.items.length).toBe(20)
    const first = res.body.items[0]
    expect(first.grade).toBeTruthy()
    expect(first.grade.name).toBeTruthy()
    expect(first.section).toBeTruthy()
    expect(first.section.name).toBeTruthy()
  })
})

describe('§4 acceptance: enrollment overflow 422', () => {
  it('rejects enrollment into a full section, then accepts allowOverflow', async () => {
    const stuA = await request(baseUrl, 'POST', '/api/students', {
      token: adminToken,
      body: { admission_no: 'IT-OVF-A', first_name: 'Overflow', last_name: 'Alpha' },
    })
    const stuB = await request(baseUrl, 'POST', '/api/students', {
      token: adminToken,
      body: { admission_no: 'IT-OVF-B', first_name: 'Overflow', last_name: 'Beta' },
    })
    const grades = await request(baseUrl, 'GET', '/api/grade-levels', { token: adminToken })
    const gradeId = grades.body.items[0].id

    const sec = await request(baseUrl, 'POST', '/api/sections', {
      token: adminToken,
      body: { academic_year_id: academicYearId, grade_level_id: gradeId, name: 'IT Overflow', capacity: 1 },
    })
    const sectionId = sec.body.id

    const first = await request(baseUrl, 'POST', '/api/enrollments', {
      token: adminToken,
      body: { student_id: stuA.body.id, section_id: sectionId },
    })
    expect(first.status).toBe(201)

    const overflow = await request(baseUrl, 'POST', '/api/enrollments', {
      token: adminToken,
      body: { student_id: stuB.body.id, section_id: sectionId },
    })
    expect(overflow.status).toBe(422)
    expect(overflow.body.error).toBe('SectionFull')
    expect(overflow.body.details.capacity).toBe(1)

    const allowed = await request(baseUrl, 'POST', '/api/enrollments', {
      token: adminToken,
      body: { student_id: stuB.body.id, section_id: sectionId, allowOverflow: true, reason: 'Parent request' },
    })
    expect(allowed.status).toBe(201)
  })
})

describe('§5 acceptance: timetable conflict 422', () => {
  it('accepts a free slot, then rejects a section clash at the same slot', async () => {
    const slotBody = {
      academic_year_id: academicYearId,
      section_id: primarySectionId,
      subject_id: engSubjectId,
      teacher_id: teacher1StaffId,
      room_id: null,
      weekday: 6,
      period_id: periodId,
      effective_from: '2026-08-15',
    }

    const free = await request(baseUrl, 'POST', '/api/timetable/slots', { token: adminToken, body: slotBody })
    expect(free.status).toBe(201)

    const clash = await request(baseUrl, 'POST', '/api/timetable/slots', {
      token: adminToken,
      body: { ...slotBody, subject_id: mthSubjectId, teacher_id: teacher2StaffId },
    })
    expect(clash.status).toBe(422)
    expect(clash.body.error).toBe('TimetableConflict')
    expect(clash.body.details.violations.some((v: any) => v.code === 'section_clash')).toBe(true)
  })
})

describe('§6 acceptance: attendance finalize lock 423', () => {
  it('records attendance, finalizes, then blocks edits without a reason', async () => {
    const session = await request(baseUrl, 'POST', '/api/attendance/sessions', {
      token: adminToken,
      body: { section_id: primarySectionId, date: '2027-01-05', period_id: periodId },
    })
    expect(session.status).toBe(201)
    const sessionId = session.body.id

    const put = await request(baseUrl, 'PUT', `/api/attendance/sessions/${sessionId}/records`, {
      token: adminToken,
      body: {
        records: [
          { student_id: primaryStudentId, status: 'present' },
          { student_id: otherStudentId, status: 'absent' },
        ],
      },
    })
    expect(put.status).toBe(200)

    const summary = await request(
      baseUrl,
      'GET',
      `/api/attendance/summary?termId=${term2Id}&scope=section&sectionId=${primarySectionId}`,
      { token: adminToken },
    )
    expect(summary.status).toBe(200)
    const presentRow = summary.body.items.find((r: any) => r.student_id === primaryStudentId)
    const absentRow = summary.body.items.find((r: any) => r.student_id === otherStudentId)
    expect(presentRow.present).toBe(1)
    expect(presentRow.percentage).toBe(100)
    expect(absentRow.absent).toBe(1)
    expect(absentRow.percentage).toBe(0)

    const fin = await request(baseUrl, 'POST', `/api/attendance/sessions/${sessionId}/finalize`, { token: adminToken })
    expect(fin.status).toBe(200)

    const blocked = await request(baseUrl, 'PUT', `/api/attendance/sessions/${sessionId}/records`, {
      token: teacherToken,
      body: { records: [{ student_id: primaryStudentId, status: 'late' }] },
    })
    expect(blocked.status).toBe(423)
    expect(blocked.body.error).toBe('Locked')

    const withReason = await request(baseUrl, 'PUT', `/api/attendance/sessions/${sessionId}/records`, {
      token: teacherToken,
      body: { records: [{ student_id: primaryStudentId, status: 'late' }], reason: 'Correcting a data-entry error' },
    })
    expect(withReason.status).toBe(200)

    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'attendance.edit_finalized' AND entity_id = $1`,
      [sessionId],
    )
    expect(audit.rowCount).toBeGreaterThanOrEqual(1)
  })
})

describe('§7 acceptance: mark validation', () => {
  it('rejects a score above max_score naming the row, then accepts valid marks', async () => {
    const assessment = await request(baseUrl, 'POST', '/api/assessments', {
      token: adminToken,
      body: { term_id: term2Id, section_id: primarySectionId, subject_id: engSubjectId, title: 'IT Unit Test', max_score: 100 },
    })
    expect(assessment.status).toBe(201)
    const assessmentId = assessment.body.id

    const invalid = await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: adminToken,
      body: {
        marks: [
          { student_id: primaryStudentId, score: 150 },
          { student_id: otherStudentId, score: 90 },
        ],
      },
    })
    expect(invalid.status).toBe(422)
    expect(invalid.body.error).toBe('Unprocessable')
    const badRows = invalid.body.details.rows as any[]
    expect(badRows.some((r) => r.student_id === primaryStudentId && /exceeds max_score/.test(r.reason))).toBe(true)

    const valid = await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: adminToken,
      body: {
        marks: [
          { student_id: primaryStudentId, score: 80 },
          { student_id: otherStudentId, score: 90 },
        ],
      },
    })
    expect(valid.status).toBe(200)
  })
})

describe('§8 acceptance: grades trace', () => {
  it('returns subject %, letter, GPA and a trace with dropped-lowest + renormalized weights', async () => {
    const res = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}/grades?termId=${term1Id}`, {
      token: adminToken,
    })
    expect(res.status).toBe(200)
    expect(typeof res.body.overall_percentage).toBe('number')

    const eng = res.body.subjects.find((s: any) => s.subject_code === 'ENG')
    expect(eng).toBeTruthy()
    expect(typeof eng.percentage).toBe('number')
    expect(typeof eng.gpa).toBe('number')
    expect(typeof eng.letter).toBe('string')

    const homework = eng.trace.find((c: any) => c.name === 'Homework')
    expect(homework.entries.some((e: any) => e.is_dropped && e.drop_reason === 'dropped-lowest')).toBe(true)

    const included = eng.trace.filter((c: any) => c.category_pct != null)
    const totalWeight = included.reduce((sum: number, c: any) => sum + c.renormalized_weight_pct, 0)
    expect(Math.abs(totalWeight - 100)).toBeLessThan(0.1)
  })
})

describe('§9 acceptance: report-card publish + revise', () => {
  it('publishes a snapshot hash, keeps it after a mark change, and creates v2 on revise', async () => {
    const gen = await request(baseUrl, 'POST', '/api/report-cards/generate', {
      token: adminToken,
      body: { termId: term2Id, sectionId: primarySectionId },
    })
    expect(gen.status).toBe(201)
    expect(gen.body.created).toBeGreaterThanOrEqual(1)

    const cards = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}/report-cards`, { token: adminToken })
    const card = cards.body.items.find((c: any) => c.term_id === term2Id && c.status === 'draft')
    expect(card).toBeTruthy()

    const pub = await request(baseUrl, 'POST', `/api/report-cards/${card.id}/publish`, { token: adminToken })
    expect(pub.status).toBe(200)
    expect(pub.body.status).toBe('published')
    const hashBefore = pub.body.snapshot_hash
    expect(hashBefore).toBeTruthy()

    const assessments = await request(baseUrl, 'GET', `/api/assessments?termId=${term2Id}&sectionId=${primarySectionId}&subjectId=${engSubjectId}`, { token: adminToken })
    const assessmentId = assessments.body.items[0].id
    await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: adminToken,
      body: { marks: [{ student_id: primaryStudentId, score: 95 }] },
    })

    const afterChange = await request(baseUrl, 'GET', `/api/report-cards/${card.id}`, { token: adminToken })
    expect(afterChange.body.snapshot_hash).toBe(hashBefore)

    const revise = await request(baseUrl, 'POST', `/api/report-cards/${card.id}/revise`, {
      token: adminToken,
      body: { reason: 'Recheck a mark' },
    })
    expect(revise.status).toBe(201)
    expect(revise.body.version).toBe(2)
    expect(revise.body.status).toBe('draft')

    const all = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}/report-cards`, { token: adminToken })
    const versions = all.body.items.filter((c: any) => c.term_id === term2Id)
    expect(versions.some((c: any) => c.version === 1 && c.status === 'published')).toBe(true)
    expect(versions.some((c: any) => c.version === 2 && c.status === 'draft')).toBe(true)
  })
})

describe('§10-12 acceptance: invoice run + partial payment', () => {
  it('dry-run computes correct minor-unit totals for a new fee student without persisting', async () => {
    const stu = await request(baseUrl, 'POST', '/api/students', {
      token: adminToken,
      body: { admission_no: 'IT-FEE-001', first_name: 'Fee', last_name: 'Student' },
    })
    feeStudentId = stu.body.id

    const grades = await request(baseUrl, 'GET', '/api/grade-levels', { token: adminToken })
    const gradeId = grades.body.items[0].id

    const sec = await request(baseUrl, 'POST', '/api/sections', {
      token: adminToken,
      body: { academic_year_id: academicYearId, grade_level_id: gradeId, name: 'IT Fee', capacity: 5 },
    })
    await request(baseUrl, 'POST', '/api/enrollments', {
      token: adminToken,
      body: { student_id: feeStudentId, section_id: sec.body.id },
    })

    const structures = await request(baseUrl, 'GET', `/api/fee-structures?academicYearId=${academicYearId}`, { token: adminToken })
    const structure = structures.body.items.find((s: any) => s.grade_level_id === gradeId) ?? structures.body.items[0]
    await request(baseUrl, 'POST', '/api/fee-assignments', {
      token: adminToken,
      body: { student_id: feeStudentId, structure_id: structure.id, academic_year_id: academicYearId },
    })

    const discounts = await request(baseUrl, 'GET', '/api/discounts', { token: adminToken })
    const sibling = discounts.body.items.find((d: any) => d.name === 'Sibling discount')
    const sd = await request(baseUrl, 'POST', '/api/student-discounts', {
      token: adminToken,
      body: { student_id: feeStudentId, discount_id: sibling.id, academic_year_id: academicYearId },
    })
    await request(baseUrl, 'POST', `/api/student-discounts/${sd.body.id}/decision`, {
      token: adminToken,
      body: { decision: 'approved' },
    })

    const dryRun = await request(baseUrl, 'POST', '/api/fees/invoice-runs', {
      token: adminToken,
      body: { academicYearId, dryRun: true },
    })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body.created).toBe(0)
    expect(dryRun.body.skipped).toBe(0)

    const mine = dryRun.body.invoices.filter((i: any) => i.studentId === feeStudentId)
    expect(mine.length).toBe(2)
    const term1 = mine.find((i: any) => i.termId === term1Id)
    const term2 = mine.find((i: any) => i.termId === term2Id)
    // Term 1: Tuition 500000 + Transport 150000 + Meals 20000 x 5 + Activity 10000 = 760000.
    expect(term1.subtotalMinor).toBe('760000')
    expect(term1.discountMinor).toBe('50000')
    expect(term1.totalMinor).toBe('710000')
    // Term 2: Tuition 500000 + Transport 150000 + Meals 20000 x 4 = 730000.
    expect(term2.subtotalMinor).toBe('730000')
    expect(term2.discountMinor).toBe('50000')
    expect(term2.totalMinor).toBe('680000')
  })

  it('real run creates the new invoices and is idempotent on re-run', async () => {
    const real = await request(baseUrl, 'POST', '/api/fees/invoice-runs', {
      token: adminToken,
      body: { academicYearId },
    })
    expect(real.status).toBe(201)
    expect(real.body.created).toBe(2)
    expect(real.body.skipped).toBe(256)

    const rerun = await request(baseUrl, 'POST', '/api/fees/invoice-runs', {
      token: adminToken,
      body: { academicYearId },
    })
    expect(rerun.status).toBe(201)
    expect(rerun.body.created).toBe(0)
    expect(rerun.body.skipped).toBe(258)

    const count = await pool.query(
      `SELECT term_id, count(*)::int AS n FROM invoices WHERE student_id = $1 GROUP BY term_id`,
      [feeStudentId],
    )
    const byTerm = new Map(count.rows.map((r: any) => [r.term_id, r.n]))
    expect(byTerm.get(term1Id)).toBe(1)
    expect(byTerm.get(term2Id)).toBe(1)

    const inv = await pool.query(
      `SELECT id, total_minor FROM invoices WHERE student_id = $1 AND term_id = $2`,
      [feeStudentId, term2Id],
    )
    feeTerm2InvoiceId = inv.rows[0].id
    expect(Number(inv.rows[0].total_minor)).toBe(680000)
  })

  it('partial payment sets partially_paid with a gapless receipt and a ledger entry', async () => {
    const pay = await request(baseUrl, 'POST', '/api/payments', {
      token: adminToken,
      body: {
        student_id: feeStudentId,
        amount_minor: 300000,
        method: 'bank_transfer',
        allocations: [{ invoice_id: feeTerm2InvoiceId, amount_minor: 300000 }],
      },
    })
    expect(pay.status).toBe(201)
    expect(pay.body.allocated_minor).toBe(300000)
    expect(pay.body.unapplied_minor).toBe(0)
    expect(pay.body.receipt_no).toMatch(/^RCT-\d{6}$/)
    expect(pay.body.allocations[0].invoice_id).toBe(feeTerm2InvoiceId)
    expect(pay.body.allocations[0].amount_minor).toBe(300000)

    const inv = await request(baseUrl, 'GET', `/api/invoices/${feeTerm2InvoiceId}`, { token: adminToken })
    expect(inv.status).toBe(200)
    expect(inv.body.status).toBe('partially_paid')
    expect(inv.body.balance_minor).toBe(380000)
    expect(inv.body.paid_minor).toBe(300000)

    const ledger = await request(baseUrl, 'GET', `/api/students/${feeStudentId}/ledger`, { token: adminToken })
    expect(ledger.status).toBe(200)
    expect(ledger.body.reconciled).toBe(true)
    expect(ledger.body.items.some((e: any) => e.kind === 'payment')).toBe(true)
  })
})

describe('§13 acceptance: receipt-number concurrency', () => {
  it('20 concurrent payments mint 20 distinct gapless receipt numbers', async () => {
    const { rows } = await pool.query(
      `SELECT student_id FROM invoices
        WHERE balance_minor >= 100 AND status IN ('issued','partially_paid','overdue')
        GROUP BY student_id ORDER BY student_id LIMIT 20`,
    )
    const ids = rows.map((r: any) => r.student_id)
    expect(ids.length).toBe(20)

    const payments = await Promise.all(
      ids.map((studentId: string, i: number) =>
        request(baseUrl, 'POST', '/api/payments', {
          token: adminToken,
          body: { student_id: studentId, amount_minor: 100, method: 'cash', reference: `CONC-${i}` },
        }),
      ),
    )

    payments.forEach((p) => expect(p.status).toBe(201))

    const numbers = payments
      .map((p) => p.body.receipt_no)
      .map((n: string) => Number(n.replace('RCT-', '')))
    expect(new Set(numbers).size).toBe(20)

    const sorted = [...numbers].sort((a, b) => a - b)
    expect(sorted[sorted.length - 1] - sorted[0] + 1).toBe(20)
  })
})

describe('§14 acceptance: late-fee idempotency', () => {
  it('charging late fees twice on the same day adds exactly one line per invoice', async () => {
    await pool.query(
      `UPDATE invoices SET due_date = CURRENT_DATE - 10, status = 'issued' WHERE id = $1`,
      [feeTerm2InvoiceId],
    )

    const first = await request(baseUrl, 'POST', '/api/fees/late-fees', { token: adminToken })
    expect(first.status).toBe(200)
    expect(first.body.charged).toBeGreaterThanOrEqual(1)

    const second = await request(baseUrl, 'POST', '/api/fees/late-fees', { token: adminToken })
    expect(second.status).toBe(200)
    expect(second.body.charged).toBe(0)

    const dup = await pool.query(
      `SELECT reference_id, count(*)::int AS n
         FROM ledger_entries
        WHERE kind = 'late_fee' AND entry_date = CURRENT_DATE
        GROUP BY reference_id
        HAVING count(*) > 1`,
    )
    expect(dup.rowCount).toBe(0)
  })
})

describe('§15 acceptance: ledger reconciliation', () => {
  it('Σ debits − Σ credits equals outstanding balances', async () => {
    const global = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(debit_minor),0)::bigint - COALESCE(SUM(credit_minor),0)::bigint FROM ledger_entries) AS net,
         (SELECT COALESCE(SUM(balance_minor),0)::bigint FROM invoices WHERE status NOT IN ('void','draft')) AS outstanding`,
    )
    expect(Number(global.rows[0].net)).toBe(Number(global.rows[0].outstanding))

    const ledger = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}/ledger`, { token: adminToken })
    expect(ledger.body.reconciled).toBe(true)
  })
})

describe('§16 acceptance: fees summary', () => {
  it('collected + outstanding == billed, aging buckets sum to outstanding', async () => {
    const res = await request(baseUrl, 'GET', `/api/fees/summary?academicYearId=${academicYearId}`, { token: adminToken })
    expect(res.status).toBe(200)
    const s = res.body
    expect(s.billed_minor).toBe(s.collected_minor + s.outstanding_minor)
    expect(s.overdue_minor).toBeLessThanOrEqual(s.outstanding_minor)
    const agingSum = s.aging_buckets.reduce((sum: number, b: any) => sum + b.amount_minor, 0)
    expect(agingSum).toBe(s.outstanding_minor)
  })
})

describe('§17 acceptance: guardian scoping', () => {
  it('guardian sees own child (200), not others (404), only own children, and admin routes 403', async () => {
    const own = await request(baseUrl, 'GET', `/api/students/${ownChildId}`, { token: guardianToken })
    expect(own.status).toBe(200)

    const other = await request(baseUrl, 'GET', `/api/students/${otherStudentId}`, { token: guardianToken })
    expect(other.status).toBe(404)

    const list = await request(baseUrl, 'GET', '/api/students?page=1&pageSize=20', { token: guardianToken })
    expect(list.body.total).toBe(1)
    expect(list.body.items.every((s: any) => s.id === ownChildId)).toBe(true)

    const adminOnly = await request(baseUrl, 'GET', '/api/staff', { token: guardianToken })
    expect(adminOnly.status).toBe(403)
  })
})

describe('§17 acceptance: student scoping', () => {
  it('student sees self (200), not others (404), and admin routes 403', async () => {
    const self = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}`, { token: studentToken })
    expect(self.status).toBe(200)

    const other = await request(baseUrl, 'GET', `/api/students/${otherStudentId}`, { token: studentToken })
    expect(other.status).toBe(404)

    const adminOnly = await request(baseUrl, 'GET', '/api/staff', { token: studentToken })
    expect(adminOnly.status).toBe(403)
  })
})

describe('§18 acceptance: teacher scoping', () => {
  it('teacher sees assigned section (200), unassigned (404), and cannot publish (403)', async () => {
    const assigned = await request(baseUrl, 'GET', `/api/sections/${primarySectionId}/roster`, { token: teacherToken })
    expect(assigned.status).toBe(200)

    const grades = await request(baseUrl, 'GET', '/api/grade-levels', { token: adminToken })
    const sec = await request(baseUrl, 'POST', '/api/sections', {
      token: adminToken,
      body: { academic_year_id: academicYearId, grade_level_id: grades.body.items[0].id, name: 'IT Unassigned', capacity: 5 },
    })
    const unassigned = await request(baseUrl, 'GET', `/api/sections/${sec.body.id}/roster`, { token: teacherToken })
    expect(unassigned.status).toBe(404)

    const cards = await request(baseUrl, 'GET', `/api/students/${primaryStudentId}/report-cards`, { token: adminToken })
    const publish = await request(baseUrl, 'POST', `/api/report-cards/${cards.body.items[0].id}/publish`, { token: teacherToken })
    expect(publish.status).toBe(403)
  })
})

describe('§19 acceptance: term lock 423', () => {
  it('locked term blocks marks for non-admin, admin override with reason succeeds and is audited', async () => {
    const assessment = await request(baseUrl, 'POST', '/api/assessments', {
      token: adminToken,
      body: { term_id: term1Id, section_id: primarySectionId, subject_id: engSubjectId, title: 'IT Locked Term', max_score: 100 },
    })
    const assessmentId = assessment.body.id

    const blocked = await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: teacherToken,
      body: { marks: [{ student_id: primaryStudentId, score: 70 }] },
    })
    expect(blocked.status).toBe(423)
    expect(blocked.body.error).toBe('TermLocked')

    const adminNoReason = await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: adminToken,
      body: { marks: [{ student_id: primaryStudentId, score: 70 }] },
    })
    expect(adminNoReason.status).toBe(423)

    const override = await request(baseUrl, 'PUT', `/api/assessments/${assessmentId}/marks`, {
      token: adminToken,
      body: { marks: [{ student_id: primaryStudentId, score: 70 }], reason: 'Appeals committee decision' },
    })
    expect(override.status).toBe(200)

    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'marks.edit_locked_term' AND entity_id = $1`,
      [assessmentId],
    )
    expect(audit.rowCount).toBeGreaterThanOrEqual(1)
  })
})
