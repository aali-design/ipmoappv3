import { pool } from './pool.js'
import { config } from '../config.js'
import { hashPassword } from '../lib/crypto.js'
import { logger } from '../lib/logger.js'
import { runInvoiceGeneration, recordPayment, applyLateFees } from '../services/fees.js'
import { buildSectionReportCards } from '../services/reportCards.js'

/**
 * Demo seeder (spec §2, WS-1). Runs after migrations and only when the
 * configured school does not yet exist, so it is idempotent across boots.
 *
 * Structural data (people, academic structure, timetable, attendance,
 * assessments, marks, fee definitions) is written inside one transaction so a
 * mid-seed failure rolls back cleanly and a later boot can retry. The fee
 * invoice/payment phases and report-card generation reuse the same service
 * functions the API exposes, which guarantees the ledger, receipt-number and
 * snapshot-hash invariants hold for the demo data.
 */

const DEMO_PASSWORD = 'Password123!'

const GRADE_NAMES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8']

const CORE_SUBJECTS: { code: string; name: string; credit: number }[] = [
  { code: 'ENG', name: 'English', credit: 1.0 },
  { code: 'MTH', name: 'Mathematics', credit: 1.0 },
  { code: 'SCI', name: 'Science', credit: 1.0 },
  { code: 'SST', name: 'Social Studies', credit: 0.5 },
  { code: 'ART', name: 'Art & Craft', credit: 0.5 },
  { code: 'MUS', name: 'Music', credit: 0.5 },
  { code: 'PHE', name: 'Physical Education', credit: 0.5 },
  { code: 'ICT', name: 'Computing', credit: 0.5 },
]

const ELECTIVE_SUBJECTS: { code: string; name: string; credit: number }[] = [
  { code: 'FRE', name: 'French', credit: 0.5 },
  { code: 'REL', name: 'Religious Studies', credit: 0.5 },
  { code: 'LIT', name: 'Literature', credit: 0.5 },
  { code: 'GEO', name: 'Geography', credit: 0.5 },
  { code: 'HIS', name: 'History', credit: 0.5 },
  { code: 'DRA', name: 'Drama', credit: 0.5 },
]

const FIRST_NAMES = [
  'Amara', 'Kwame', 'Zainab', 'Liam', 'Naledi', 'Mateo', 'Sofia', 'Ethan',
  'Aisha', 'Omar', 'Priya', 'Noah', 'Chidi', 'Layla', 'Tariq', 'Maya',
  'Ibrahim', 'Hana', 'Daniel', 'Fatima', 'Kofi', 'Sana', 'Lucas', 'Nadia',
  'Yusuf', 'Mariam', 'Leo', 'Amina', 'Tunde', 'Rosa', 'Emeka', 'Ines',
  'Jamal', 'Zara', 'Peter', 'Sara', 'Musa', 'Elena', 'David', 'Lina',
  'Ali', 'Ruth', 'Samuel', 'Grace', 'Hassan', 'Marta', 'Jonah', 'Nora',
]

const LAST_NAMES = [
  'Okafor', 'Mensah', 'Silva', 'Nguyen', 'Khan', 'Patel', 'Mbeki', 'Garcia',
  'Ahmed', 'Rossi', 'Kim', 'Martins', 'Diallo', 'Chen', 'Osei', 'Lopez',
  'Haddad', 'Novak', 'Adebayo', 'Santos', 'Bello', 'Wong', 'Mwangi', 'Costa',
  'Farah', 'Ivanov', 'Eze', 'Moreau', 'Juma', 'Fernandez', 'Nkosi', 'Petrov',
]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function schoolDays(start: string, count: number): string[] {
  const days: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  while (days.length < count) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days.push(isoDate(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

export async function seedIfEmpty(): Promise<boolean> {
  const existing = await pool.query(`SELECT id FROM schools WHERE slug = $1`, [config.schoolSlug])
  if ((existing.rowCount ?? 0) > 0) return false

  logger.info('seeding demo data', { school: config.schoolSlug })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const schoolId = await seedStructural(client)
    await client.query('COMMIT')

    await seedReportCards(schoolId)
    await seedFees(schoolId)

    logger.info('seed complete', { school: config.schoolSlug })
    return true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

async function seedStructural(client: import('pg').PoolClient): Promise<string> {
  // ---- School ------------------------------------------------------------
  const settings = {
    holidays: ['2026-12-25', '2027-01-01', '2027-04-02', '2027-04-05'],
    lateEqualsAbsentCount: 3,
    minAttendancePct: 75,
    lateFeePolicy: { graceDays: 5, kind: 'percent', value: 2, capMinor: 5000, chargeOncePerPeriod: true },
  }
  const schoolRes = await client.query(
    `INSERT INTO schools (name, slug, timezone, currency, locale, settings_json)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    ['Scholarion Academy', config.schoolSlug, 'America/New_York', 'USD', 'en', JSON.stringify(settings)],
  )
  const schoolId = schoolRes.rows[0].id as string

  // ---- Users -------------------------------------------------------------
  const userInserts: { role: string; email: string; name: string; password: string }[] = []
  userInserts.push({ role: 'admin', email: config.adminEmail, name: 'Administrator', password: config.adminPassword })
  userInserts.push({ role: 'registrar', email: 'registrar@scholarion.local', name: 'Regina Registrar', password: DEMO_PASSWORD })
  userInserts.push({ role: 'accountant', email: 'accountant@scholarion.local', name: 'Aaron Accountant', password: DEMO_PASSWORD })
  for (let i = 1; i <= 12; i++) {
    userInserts.push({ role: 'teacher', email: `teacher${i}@scholarion.local`, name: `Teacher ${i}`, password: DEMO_PASSWORD })
  }
  for (let i = 1; i <= 6; i++) {
    userInserts.push({ role: 'guardian', email: `guardian${i}@scholarion.local`, name: `Guardian ${i}`, password: DEMO_PASSWORD })
  }
  for (let i = 1; i <= 6; i++) {
    userInserts.push({ role: 'student', email: `student${i}@scholarion.local`, name: `Student ${i}`, password: DEMO_PASSWORD })
  }

  const userIds: Record<string, string> = {}
  let adminUserId = ''
  for (const u of userInserts) {
    const res = await client.query(
      `INSERT INTO users (school_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, u.email, hashPassword(u.password), u.name, u.role],
    )
    userIds[u.email] = res.rows[0].id as string
    if (u.role === 'admin') adminUserId = res.rows[0].id as string
  }

  // ---- Staff (teachers) ---------------------------------------------------
  const teacherStaffIds: string[] = []
  for (let i = 1; i <= 12; i++) {
    const res = await client.query(
      `INSERT INTO staff (school_id, user_id, employee_no, full_name, designation, hired_on)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        schoolId,
        userIds[`teacher${i}@scholarion.local`],
        `EMP-${String(i).padStart(3, '0')}`,
        `Teacher ${i}`,
        'Teacher',
        '2024-08-15',
      ],
    )
    teacherStaffIds.push(res.rows[0].id as string)
  }

  // ---- Academic year + terms ---------------------------------------------
  const ayRes = await client.query(
    `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current, status)
     VALUES ($1,$2,$3,$4,true,'active') RETURNING id`,
    [schoolId, '2026/2027', '2026-08-15', '2027-07-15'],
  )
  const academicYearId = ayRes.rows[0].id as string

  const termDefs = [
    { name: 'Term 1', seq: 1, starts: '2026-08-15', ends: '2026-12-18', status: 'locked' },
    { name: 'Term 2', seq: 2, starts: '2027-01-04', ends: '2027-04-02', status: 'active' },
    { name: 'Term 3', seq: 3, starts: '2027-04-19', ends: '2027-07-15', status: 'planning' },
  ]
  const termIds: string[] = []
  for (const t of termDefs) {
    const res = await client.query(
      `INSERT INTO terms (academic_year_id, name, sequence, starts_on, ends_on, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [academicYearId, t.name, t.seq, t.starts, t.ends, t.status],
    )
    termIds.push(res.rows[0].id as string)
  }
  const [term1Id, term2Id, term3Id] = termIds
  void term3Id

  // ---- Grade levels + sections -------------------------------------------
  const gradeLevelIds: string[] = []
  for (let g = 0; g < 8; g++) {
    const res = await client.query(
      `INSERT INTO grade_levels (school_id, name, sequence) VALUES ($1,$2,$3) RETURNING id`,
      [schoolId, GRADE_NAMES[g], g + 1],
    )
    gradeLevelIds.push(res.rows[0].id as string)
  }

  const sectionIds: string[] = []
  const sectionGradeMap = new Map<string, string>()
  for (let g = 0; g < 8; g++) {
    for (const letter of ['A', 'B']) {
      const res = await client.query(
        `INSERT INTO sections (academic_year_id, grade_level_id, name, capacity, homeroom_teacher_id)
         VALUES ($1,$2,$3,10,$4) RETURNING id`,
        [academicYearId, gradeLevelIds[g], `${GRADE_NAMES[g]} ${letter}`, teacherStaffIds[(g * 2 + (letter === 'A' ? 0 : 1)) % 12]],
      )
      const sid = res.rows[0].id as string
      sectionIds.push(sid)
      sectionGradeMap.set(sid, gradeLevelIds[g])
    }
  }

  // ---- Subjects -----------------------------------------------------------
  const allSubjects = [...CORE_SUBJECTS, ...ELECTIVE_SUBJECTS]
  const subjectIds = new Map<string, string>()
  for (const s of allSubjects) {
    const res = await client.query(
      `INSERT INTO subjects (school_id, code, name, credit_hours, is_elective)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, s.code, s.name, s.credit.toFixed(1), false],
    )
    subjectIds.set(s.code, res.rows[0].id as string)
  }
  const coreSubjectIds = CORE_SUBJECTS.map((s) => subjectIds.get(s.code) as string)

  // grade_subjects: all 14 subjects for every grade level
  for (const gl of gradeLevelIds) {
    for (const code of allSubjects.map((s) => s.code)) {
      await client.query(
        `INSERT INTO grade_subjects (grade_level_id, subject_id, is_mandatory)
         VALUES ($1,$2,true)`,
        [gl, subjectIds.get(code)],
      )
    }
  }

  // ---- Rooms (one per section) -------------------------------------------
  const roomIds: string[] = []
  for (let i = 0; i < 16; i++) {
    const res = await client.query(
      `INSERT INTO rooms (school_id, name, capacity, kind) VALUES ($1,$2,12,'classroom') RETURNING id`,
      [schoolId, `Room ${String(i + 1).padStart(2, '0')}`],
    )
    roomIds.push(res.rows[0].id as string)
  }

  // ---- Periods (8/day, seq 4 = break) -------------------------------------
  const periodIds: (string | null)[] = []
  const periodTimes = [
    ['08:00', '08:45'],
    ['08:50', '09:35'],
    ['09:40', '10:25'],
    ['10:25', '10:45'],
    ['10:45', '11:30'],
    ['11:35', '12:20'],
    ['12:20', '13:05'],
    ['13:05', '13:50'],
  ]
  for (let i = 0; i < 8; i++) {
    const isBreak = i === 3
    const res = await client.query(
      `INSERT INTO periods (academic_year_id, sequence, label, starts_at, ends_at, is_break)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [academicYearId, i + 1, isBreak ? 'Break' : `Period ${i + 1}`, periodTimes[i][0], periodTimes[i][1], isBreak],
    )
    periodIds.push(isBreak ? null : (res.rows[0].id as string))
  }

  // ---- Teaching assignments + timetable (conflict-free greedy) -------------
  // Cells = 5 weekdays x 7 teaching periods (seq 1,2,3,5,6,7,8), indexed 0..34.
  const cells: { weekday: number; periodId: string }[] = []
  for (let w = 1; w <= 5; w++) {
    for (const p of [1, 2, 3, 5, 6, 7, 8]) {
      cells.push({ weekday: w, periodId: periodIds[p - 1] as string })
    }
  }

  // Conflict-free timetable by construction: subject j is taught by dedicated
  // teacher j, and its k-th period in section s lands on cell (2s + 2j + k)
  // mod 35. Within a section the 16 cells are distinct (no section clash); for
  // a teacher the 32 cells are distinct (no double-book); each section has its
  // own room (no room clash).
  for (let s = 0; s < 16; s++) {
    for (let j = 0; j < 8; j++) {
      const teacherId = teacherStaffIds[j]
      const sectionId = sectionIds[s]
      const subjectId = coreSubjectIds[j]
      await client.query(
        `INSERT INTO teaching_assignments (section_id, subject_id, teacher_id, academic_year_id)
         VALUES ($1,$2,$3,$4)`,
        [sectionId, subjectId, teacherId, academicYearId],
      )
      for (let k = 0; k < 2; k++) {
        const ci = (2 * s + 2 * j + k) % cells.length
        await client.query(
          `INSERT INTO timetable_slots
            (academic_year_id, section_id, subject_id, teacher_id, room_id, weekday, period_id, effective_from)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [academicYearId, sectionId, subjectId, teacherId, roomIds[s], cells[ci].weekday, cells[ci].periodId, '2026-08-15'],
        )
      }
    }
  }

  // ---- Students, guardians, guardianships, enrollments ---------------------
  const sectionCapacity = 8
  const studentsBySection: string[][] = []
  const guardianStudentMap = new Map<number, string>() // studentIdx -> guardianId
  const studentUserIds: string[] = []
  for (let i = 1; i <= 6; i++) studentUserIds.push(userIds[`student${i}@scholarion.local`])
  const guardianUserIds: string[] = []
  for (let i = 1; i <= 6; i++) guardianUserIds.push(userIds[`guardian${i}@scholarion.local`])

  let studentCounter = 0
  for (let s = 0; s < 16; s++) {
    const sectionStudents: string[] = []
    for (let k = 0; k < sectionCapacity; k++) {
      const idx = studentCounter
      const first = FIRST_NAMES[idx % FIRST_NAMES.length]
      const last = LAST_NAMES[(idx * 3) % LAST_NAMES.length]
      const admissionNo = `ADM-${String(idx + 1).padStart(4, '0')}`
      const dob = addDays(new Date('2014-01-01T00:00:00Z'), (idx * 37) % (365 * 8)).toISOString().slice(0, 10)
      const gender = idx % 2 === 0 ? 'male' : 'female'
      const studentUser = idx < 6 ? studentUserIds[idx] : null

      const stuRes = await client.query(
        `INSERT INTO students (school_id, admission_no, user_id, first_name, last_name, date_of_birth, gender, status, admitted_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active','2026-08-15') RETURNING id`,
        [schoolId, admissionNo, studentUser, first, last, dob, gender],
      )
      const studentId = stuRes.rows[0].id as string
      sectionStudents.push(studentId)

      // guardian (one per student; first 6 have login accounts)
      const guardianUser = idx < 6 ? guardianUserIds[idx] : null
      const gRes = await client.query(
        `INSERT INTO guardians (school_id, user_id, full_name, relation, email)
         VALUES ($1,$2,$3,'parent',$4) RETURNING id`,
        [schoolId, guardianUser, `${first} ${last} Sr.`, guardianUser ? `guardian${idx + 1}@scholarion.local` : null],
      )
      const guardianId = gRes.rows[0].id as string
      guardianStudentMap.set(idx, guardianId)

      await client.query(
        `INSERT INTO guardianships (student_id, guardian_id, is_primary, is_billing_contact)
         VALUES ($1,$2,true,true)`,
        [studentId, guardianId],
      )

      const enrRes = await client.query(
        `INSERT INTO enrollments (student_id, section_id, academic_year_id, enrolled_on, roll_no, status)
         VALUES ($1,$2,$3,'2026-08-15',$4,'active') RETURNING id`,
        [studentId, sectionIds[s], academicYearId, k + 1],
      )
      void enrRes

      studentCounter++
    }
    studentsBySection.push(sectionStudents)
  }

  // ---- Attendance: 8 weeks of daily homeroom sessions (term 1) -------------
  const attendanceDays = schoolDays('2026-08-17', 40)
  const statusPool = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent', 'excused', 'sick', 'present']
  for (let s = 0; s < 16; s++) {
    const students = studentsBySection[s]
    for (const day of attendanceDays) {
      const sessRes = await client.query(
        `INSERT INTO attendance_sessions (section_id, date, taken_by, is_finalized)
         VALUES ($1,$2,$3,true) RETURNING id`,
        [sectionIds[s], day, adminUserId],
      )
      const sessionId = sessRes.rows[0].id as string
      for (let k = 0; k < students.length; k++) {
        const status = statusPool[(k * 7 + (attendanceDays.indexOf(day) * 3)) % statusPool.length]
        await client.query(
          `INSERT INTO attendance_records (session_id, student_id, status, minutes_late)
           VALUES ($1,$2,$3,$4)`,
          [sessionId, students[k], status, status === 'late' ? 8 : 0],
        )
      }
    }
  }

  // ---- Grading scale + categories + assessments + marks (term 1) -----------
  const bands = [
    { min: 90, max: 100, letter: 'A+', gpa: 4.0, remark: 'Excellent' },
    { min: 80, max: 89.99, letter: 'A', gpa: 3.7, remark: 'Very good' },
    { min: 70, max: 79.99, letter: 'B', gpa: 3.0, remark: 'Good' },
    { min: 60, max: 69.99, letter: 'C', gpa: 2.0, remark: 'Satisfactory' },
    { min: 50, max: 59.99, letter: 'D', gpa: 1.0, remark: 'Needs improvement' },
    { min: 0, max: 49.99, letter: 'F', gpa: 0.0, remark: 'Fail' },
  ]
  await client.query(
    `INSERT INTO grading_scales (school_id, name, bands_json, is_default)
     VALUES ($1,'Standard', $2, true)`,
    [schoolId, JSON.stringify(bands)],
  )

  const catDefs = [
    { name: 'Homework', weight: 20, drop: 1 },
    { name: 'Quizzes', weight: 30, drop: 0 },
    { name: 'Exams', weight: 50, drop: 0 },
  ]
  const categoryIds: string[] = []
  for (const c of catDefs) {
    const res = await client.query(
      `INSERT INTO assessment_categories (academic_year_id, name, weight_pct, drop_lowest)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [academicYearId, c.name, c.weight, c.drop],
    )
    categoryIds.push(res.rows[0].id as string)
  }
  const [homeworkCat, quizCat, examCat] = categoryIds

  for (let s = 0; s < 16; s++) {
    const students = studentsBySection[s]
    for (let j = 0; j < 8; j++) {
      const subjectId = coreSubjectIds[j]
      const assessments = [
        { title: 'Homework 1', cat: homeworkCat, max: 20 },
        { title: 'Homework 2', cat: homeworkCat, max: 20 },
        { title: 'Quiz 1', cat: quizCat, max: 30 },
        { title: 'Exam', cat: examCat, max: 100 },
      ]
      for (let a = 0; a < assessments.length; a++) {
        const aDef = assessments[a]
        const aRes = await client.query(
          `INSERT INTO assessments (term_id, section_id, subject_id, category_id, title, max_score, is_published)
           VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
          [term1Id, sectionIds[s], subjectId, aDef.cat, aDef.title, aDef.max],
        )
        const assessmentId = aRes.rows[0].id as string
        for (let k = 0; k < students.length; k++) {
          const r = (k * 11 + a * 5 + s) % 25
          let score: number | null = null
          let isAbsent = false
          let isExcused = false
          if (r === 0) isExcused = true
          else if (r === 1) isAbsent = true
          else score = Math.round(aDef.max * (0.55 + ((k * 13 + a * 7 + s) % 40) / 100) * 100) / 100
          await client.query(
            `INSERT INTO marks (assessment_id, student_id, score, is_absent, is_excused, entered_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [assessmentId, students[k], score, isAbsent, isExcused, adminUserId],
          )
        }
      }
    }
  }

  return schoolId
}

async function seedReportCards(schoolId: string): Promise<void> {
  const ayRes = await pool.query(`SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1`, [schoolId])
  const term1Res = await pool.query(
    `SELECT id FROM terms WHERE academic_year_id = $1 AND sequence = 1 LIMIT 1`,
    [ayRes.rows[0].id],
  )
  const term1Id = term1Res.rows[0].id as string

  const sections = await pool.query(
    `SELECT id FROM sections WHERE academic_year_id = $1 ORDER BY name`,
    [ayRes.rows[0].id],
  )
  const adminRes = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`, [])
  const adminId = adminRes.rows[0].id as string

  for (const s of sections.rows) {
    const built = await buildSectionReportCards(schoolId, term1Id, s.id as string)
    for (const rc of built) {
      await pool.query(
        `INSERT INTO report_cards
          (student_id, term_id, enrollment_id, status, snapshot_json, snapshot_hash,
           overall_percentage, gpa, class_rank, class_size, attendance_pct, version, published_at, published_by)
         VALUES ($1,$2,$3,'published',$4,$5,$6,$7,$8,$9,$10,1,now(),$11)
         ON CONFLICT (student_id, term_id, version) DO NOTHING`,
        [
          rc.studentId,
          term1Id,
          rc.enrollmentId,
          JSON.stringify(rc.snapshot),
          rc.snapshotHash,
          rc.overallPercentage,
          rc.gpa,
          rc.classRank,
          rc.classSize,
          rc.attendancePct,
          adminId,
        ],
      )
    }
  }
}

async function seedFees(schoolId: string): Promise<void> {
  const ayRes = await pool.query(`SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1`, [schoolId])
  const academicYearId = ayRes.rows[0].id as string

  const gradeLevels = await pool.query(`SELECT id FROM grade_levels WHERE school_id = $1 ORDER BY sequence`, [schoolId])
  const adminRes = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`, [])
  const adminId = adminRes.rows[0].id as string

  // Fee structures (one per grade level) + items
  const structureByGrade = new Map<string, string>()
  for (const gl of gradeLevels.rows) {
    const structRes = await pool.query(
      `INSERT INTO fee_structures (academic_year_id, grade_level_id, name, is_active)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [academicYearId, gl.id, `Grade fee structure`],
    )
    const structId = structRes.rows[0].id as string
    structureByGrade.set(gl.id as string, structId)
    const items = [
      { name: 'Tuition', category: 'tuition', amount: '500000', frequency: 'per_term', optional: false },
      { name: 'Transport', category: 'transport', amount: '150000', frequency: 'per_term', optional: true },
      { name: 'Meals', category: 'meals', amount: '20000', frequency: 'monthly', optional: true },
      { name: 'Activity fee', category: 'activity', amount: '10000', frequency: 'once', optional: false },
    ]
    for (const it of items) {
      await pool.query(
        `INSERT INTO fee_items (structure_id, name, category, amount_minor, frequency, is_optional)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [structId, it.name, it.category, it.amount, it.frequency, it.optional],
      )
    }
  }

  // Discounts
  const discountIds: Record<string, string> = {}
  const discountDefs = [
    { key: 'sibling', name: 'Sibling discount', kind: 'percent', value: '10.00', category: 'tuition' },
    { key: 'scholarship', name: 'Scholarship', kind: 'percent', value: '25.00', category: 'tuition' },
    { key: 'earlybird', name: 'Early bird', kind: 'fixed', value: '50.00', category: 'tuition' },
  ]
  for (const d of discountDefs) {
    const res = await pool.query(
      `INSERT INTO discounts (school_id, name, kind, value, applies_to_category)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, d.name, d.kind, d.value, d.category],
    )
    discountIds[d.key] = res.rows[0].id as string
  }

  // Fee assignments for every active student + a few approved discounts
  const students = await pool.query(
    `SELECT e.student_id, sec.grade_level_id
       FROM enrollments e
       JOIN sections sec ON sec.id = e.section_id
      WHERE e.academic_year_id = $1 AND e.left_on IS NULL
      ORDER BY e.student_id`,
    [academicYearId],
  )
  let idx = 0
  for (const st of students.rows) {
    const structId = structureByGrade.get(st.grade_level_id as string)
    if (!structId) continue
    await pool.query(
      `INSERT INTO fee_assignments (student_id, structure_id, academic_year_id, assigned_on)
       VALUES ($1,$2,$3,'2026-08-15')`,
      [st.student_id, structId, academicYearId],
    )
    if (idx % 8 === 0) {
      await pool.query(
        `INSERT INTO student_discounts (student_id, discount_id, academic_year_id, status, approved_by)
         VALUES ($1,$2,$3,'approved',$4)`,
        [st.student_id, discountIds.sibling, academicYearId, adminId],
      )
    }
    if (idx % 11 === 0) {
      await pool.query(
        `INSERT INTO student_discounts (student_id, discount_id, academic_year_id, status, approved_by)
         VALUES ($1,$2,$3,'approved',$4)`,
        [st.student_id, discountIds.scholarship, academicYearId, adminId],
      )
    }
    idx++
  }

  // Invoice runs (term 1 + term 2) via the real service → correct ledger.
  await runInvoiceGeneration({
    schoolId,
    actorId: adminId,
    academicYearId,
    termId: null,
    gradeLevelIds: null,
    dryRun: false,
  })

  const invoices = await pool.query(
    `SELECT id, student_id, term_id, total_minor FROM invoices
      WHERE school_id = $1 AND status <> 'void' ORDER BY number`,
    [schoolId],
  )

  // Payments: ~90 across the cohort (full / partial / none).
  const studentsOrdered = await pool.query(
    `SELECT student_id FROM enrollments WHERE academic_year_id = $1 AND left_on IS NULL ORDER BY student_id`,
    [academicYearId],
  )
  const studentList = studentsOrdered.rows.map((r) => r.student_id as string)
  let paymentCount = 0
  for (let i = 0; i < studentList.length; i++) {
    const studentId = studentList[i]
    const mod = i % 4
    if (mod === 0) continue // no payment → outstanding/overdue
    const term1Inv = invoices.rows.find((r) => r.student_id === studentId && r.term_id)
    if (!term1Inv) continue
    const total = BigInt(term1Inv.total_minor)
    if (total <= 0n) continue
    const amount = mod === 1 ? (total * 60n) / 100n : total
    if (amount <= 0n) continue
    const method = (['bank_transfer', 'cash', 'card', 'online'] as const)[i % 4]
    await recordPayment({
      schoolId,
      actorId: adminId,
      studentId,
      amountMinor: amount,
      method,
      reference: `SEED-${String(paymentCount + 1).padStart(4, '0')}`,
      receivedOn: '2026-08-10',
      allocations: [{ invoiceId: term1Inv.id as string, amountMinor: amount }],
    })
    paymentCount++
  }

  // Backdate term-1 invoices so the nightly late-fee job marks unpaid ones overdue.
  await pool.query(
    `UPDATE invoices SET due_date = CURRENT_DATE - 45 WHERE school_id = $1 AND term_id IS NOT NULL AND status IN ('issued','partially_paid')`,
    [schoolId],
  )
  await applyLateFees(schoolId, adminId)
}
