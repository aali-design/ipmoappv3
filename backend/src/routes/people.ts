import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler, paginated, parsePagination } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { forbidden, notFound } from '../lib/errors.js'
import type { AuthUser } from '../types.js'
import { computeStudentGrades } from '../services/grading.js'
import { attendancePercentage } from '../engines/attendance.js'
import { getSchoolAttendancePolicy } from '../services/reportCards.js'

export const peopleRouter = Router()

/**
 * Relationship scoping (spec §1): returns SQL WHERE clause + params that
 * restrict a student query to the caller's allowed scope.
 */
async function studentScope(auth: AuthUser): Promise<{ where: string; params: unknown[] }> {
  switch (auth.role) {
    case 'admin':
    case 'registrar':
    case 'accountant':
      return { where: `s.school_id = $1`, params: [auth.school_id] }
    case 'teacher': {
      if (!auth.staff_id) return { where: 'FALSE', params: [] }
      return {
        where: `s.school_id = $1 AND s.id IN (
                  SELECT e.student_id FROM enrollments e
                  JOIN teaching_assignments ta ON ta.section_id = e.section_id
                  WHERE ta.teacher_id = $2 AND e.left_on IS NULL)`,
        params: [auth.school_id, auth.staff_id],
      }
    }
    case 'student':
      return { where: `s.id = $1`, params: [auth.student_id ?? ''] }
    case 'guardian': {
      const ids = auth.student_ids ?? []
      if (ids.length === 0) return { where: 'FALSE', params: [] }
      return { where: `s.school_id = $1 AND s.id = ANY($2::uuid[])`, params: [auth.school_id, ids] }
    }
  }
}

async function assertStudentAccess(auth: AuthUser, studentId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT s.school_id FROM students s WHERE s.id = $1`,
    [studentId],
  )
  if (rows.length === 0) throw notFound('Student not found')

  switch (auth.role) {
    case 'admin':
    case 'registrar':
    case 'accountant':
      return
    case 'teacher': {
      if (!auth.staff_id) throw notFound('Student not found')
      const assigned = await pool.query(
        `SELECT 1 FROM enrollments e
           JOIN teaching_assignments ta ON ta.section_id = e.section_id
          WHERE ta.teacher_id = $1 AND e.student_id = $2 AND e.left_on IS NULL`,
        [auth.staff_id, studentId],
      )
      if (assigned.rowCount === 0) throw notFound('Student not found')
      return
    }
    case 'student':
      if (auth.student_id !== studentId) throw notFound('Student not found')
      return
    case 'guardian':
      if (!auth.student_ids?.includes(studentId)) throw notFound('Student not found')
      return
  }
}

const studentQueryColumns = `
  s.id, s.school_id, s.admission_no, s.user_id, s.first_name, s.last_name,
  s.date_of_birth, s.gender, s.nationality, s.photo_url, s.status,
  s.admitted_on, s.exited_on, s.exit_reason, s.medical_notes, s.created_at`

peopleRouter.get(
  '/students',
  authenticate,
  asyncHandler(async (req, res) => {
    const scope = await studentScope(req.auth!)
    const pag = parsePagination(req.query)
    const gradeId = req.query.grade as string | undefined
    const sectionId = req.query.section as string | undefined
    const status = req.query.status as string | undefined
    const q = req.query.q as string | undefined

    const filters: string[] = [scope.where]
    const params: unknown[] = [...scope.params]
    let pi = params.length

    if (gradeId) {
      filters.push(`s.id IN (SELECT e.student_id FROM enrollments e JOIN sections sec ON sec.id = e.section_id WHERE sec.grade_level_id = $${++pi} AND e.left_on IS NULL)`)
      params.push(gradeId)
    }
    if (sectionId) {
      filters.push(`s.id IN (SELECT e.student_id FROM enrollments e WHERE e.section_id = $${++pi} AND e.left_on IS NULL)`)
      params.push(sectionId)
    }
    if (status) {
      filters.push(`s.status = $${++pi}`)
      params.push(status)
    }
    if (q) {
      filters.push(`(s.first_name ILIKE $${++pi} OR s.last_name ILIKE $${++pi} OR s.admission_no ILIKE $${++pi})`)
      params.push(`%${q}%`)
    }

    const where = filters.join(' AND ')

    const countRes = await pool.query(
      `SELECT count(*)::int AS total FROM students s WHERE ${where}`,
      params,
    )
    const total = Number(countRes.rows[0].total)

    const listRes = await pool.query(
      `SELECT ${studentQueryColumns},
              gl.id AS grade_id, gl.name AS grade_name, gl.sequence AS grade_sequence,
              sec.id AS section_id, sec.name AS section_name,
              ay.id AS year_id, ay.name AS year_name
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.left_on IS NULL
         LEFT JOIN sections sec ON sec.id = e.section_id
         LEFT JOIN grade_levels gl ON gl.id = sec.grade_level_id
         LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
        WHERE ${where}
        ORDER BY s.last_name, s.first_name
        LIMIT $${++pi} OFFSET $${++pi}`,
      [...params, pag.limit, pag.offset],
    )

    const items = listRes.rows.map((r) => ({
      id: r.id,
      school_id: r.school_id,
      admission_no: r.admission_no,
      user_id: r.user_id,
      first_name: r.first_name,
      last_name: r.last_name,
      date_of_birth: r.date_of_birth,
      gender: r.gender,
      nationality: r.nationality,
      photo_url: r.photo_url,
      status: r.status,
      admitted_on: r.admitted_on,
      exited_on: r.exited_on,
      exit_reason: r.exit_reason,
      medical_notes: r.medical_notes,
      grade: r.grade_id ? { id: r.grade_id, name: r.grade_name, sequence: r.grade_sequence } : null,
      section: r.section_id ? { id: r.section_id, name: r.section_name, grade_name: r.grade_name } : null,
      academic_year: r.year_id ? { id: r.year_id, name: r.year_name } : null,
    }))

    res.json(paginated(items, total, pag.page, pag.pageSize))
  }),
)

const studentCreateSchema = z.object({
  admission_no: z.string().min(1),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  status: z.enum(['applicant', 'active', 'suspended', 'graduated', 'withdrawn', 'transferred']).optional(),
  admitted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  medical_notes: z.string().nullable().optional(),
})

peopleRouter.post(
  '/students',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = studentCreateSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO students (school_id, admission_no, first_name, last_name, date_of_birth, gender, nationality, status, admitted_on, medical_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, school_id, admission_no, first_name, last_name, date_of_birth, gender, nationality, status, admitted_on, medical_notes`,
      [
        req.auth!.school_id,
        body.admission_no,
        body.first_name,
        body.last_name,
        body.date_of_birth ?? null,
        body.gender ?? null,
        body.nationality ?? null,
        body.status ?? 'active',
        body.admitted_on ?? null,
        body.medical_notes ?? null,
      ],
    )
    res.status(201).json(rows[0])
  }),
)

peopleRouter.get(
  '/students/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    await assertStudentAccess(req.auth!, req.params.id)
    const { rows } = await pool.query(
      `SELECT ${studentQueryColumns} FROM students s WHERE s.id = $1 AND s.school_id = $2`,
      [req.params.id, req.auth!.school_id],
    )
    if (rows.length === 0) throw notFound('Student not found')
    res.json(rows[0])
  }),
)

const studentPatchSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  status: z.enum(['applicant', 'active', 'suspended', 'graduated', 'withdrawn', 'transferred']).optional(),
  medical_notes: z.string().nullable().optional(),
})

peopleRouter.patch(
  '/students/:id',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = studentPatchSchema.parse(req.body)
    const { rows } = await pool.query(`SELECT * FROM students WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (rows.length === 0) throw notFound('Student not found')
    const cur = rows[0]
    await pool.query(
      `UPDATE students SET first_name=$1, last_name=$2, date_of_birth=$3, gender=$4, nationality=$5, status=$6, medical_notes=$7 WHERE id=$8`,
      [
        body.first_name ?? cur.first_name,
        body.last_name ?? cur.last_name,
        body.date_of_birth !== undefined ? body.date_of_birth : cur.date_of_birth,
        body.gender !== undefined ? body.gender : cur.gender,
        body.nationality !== undefined ? body.nationality : cur.nationality,
        body.status ?? cur.status,
        body.medical_notes !== undefined ? body.medical_notes : cur.medical_notes,
        req.params.id,
      ],
    )
    res.json({ ok: true })
  }),
)

peopleRouter.get(
  '/students/:id/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    await assertStudentAccess(req.auth!, req.params.id)
    const studentId = req.params.id

    const studentRes = await pool.query(`SELECT ${studentQueryColumns} FROM students s WHERE s.id = $1`, [studentId])
    if (studentRes.rowCount === 0) throw notFound('Student not found')

    const enrollmentRes = await pool.query(
      `SELECT e.*, sec.name AS section_name, gl.name AS grade_name
         FROM enrollments e
         JOIN sections sec ON sec.id = e.section_id
         JOIN grade_levels gl ON gl.id = sec.grade_level_id
        WHERE e.student_id = $1 AND e.left_on IS NULL
        LIMIT 1`,
      [studentId],
    )
    const enrollment = enrollmentRes.rows[0]

    const guardiansRes = await pool.query(
      `SELECT g.id, g.school_id, g.user_id, g.full_name, g.relation, g.phone, g.email, g.occupation, g.address,
              gs.is_primary, gs.is_billing_contact, gs.can_pickup
         FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id
        WHERE gs.student_id = $1`,
      [studentId],
    )

    const incidentsRes = await pool.query(
      `SELECT * FROM incidents WHERE student_id = $1 ORDER BY date DESC LIMIT 20`,
      [studentId],
    )

    const feesRes = await pool.query(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint AS outstanding_minor
         FROM invoices WHERE student_id = $1 AND status <> 'void' AND status <> 'draft'`,
      [studentId],
    )

    const documentsRes = await pool.query(
      `SELECT * FROM documents WHERE school_id = $1 AND entity_type = 'student' AND entity_id = $2`,
      [req.auth!.school_id, studentId],
    )

    // Current academic year term context for grades/attendance.
    const termRes = await pool.query(
      `SELECT t.id, t.name FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE ay.school_id = $1 AND ay.is_current = true
        ORDER BY t.sequence LIMIT 1`,
      [req.auth!.school_id],
    )
    const term = termRes.rows[0]

    let grades = null
    let attendance = null
    if (term) {
      const g = await computeStudentGrades(req.auth!.school_id, studentId, term.id as string)
      grades = g.grades
      const policy = await getSchoolAttendancePolicy(req.auth!.school_id)
      const counts = await pool.query(
        `SELECT
           count(*) FILTER (WHERE ar.status = 'present') AS present,
           count(*) FILTER (WHERE ar.status = 'absent') AS absent,
           count(*) FILTER (WHERE ar.status = 'late') AS late,
           count(*) FILTER (WHERE ar.status = 'excused') AS excused,
           count(*) FILTER (WHERE ar.status = 'sick') AS sick
         FROM attendance_records ar
         JOIN attendance_sessions asess ON asess.id = ar.session_id
        WHERE ar.student_id = $1 AND asess.date BETWEEN (SELECT starts_on FROM terms WHERE id = $2) AND (SELECT ends_on FROM terms WHERE id = $2)`,
        [studentId, term.id],
      )
      const c = counts.rows[0]
      const toNum = (v: unknown) => (v == null ? 0 : Number(v))
      const present = toNum(c.present)
      const absent = toNum(c.absent)
      const late = toNum(c.late)
      const excused = toNum(c.excused)
      const sick = toNum(c.sick)
      const pct = attendancePercentage({ present, absent, late, excused, sick }, policy.lateEqualsAbsent)
      attendance = { present, absent, late, excused, sick, percentage: pct }
    }

    res.json({
      student: studentRes.rows[0],
      enrollment: enrollment
        ? {
            ...enrollment,
            section: enrollment.section_name ? { id: enrollment.section_id, name: enrollment.section_name, grade_name: enrollment.grade_name } : null,
          }
        : null,
      guardians: guardiansRes.rows,
      incidents: incidentsRes.rows,
      fees: { outstanding_minor: Number(feesRes.rows[0].outstanding_minor) },
      fees_balance_minor: Number(feesRes.rows[0].outstanding_minor),
      documents: documentsRes.rows,
      grades,
      attendance,
    })
  }),
)

const guardianLinkSchema = z.object({
  guardian_id: z.string().uuid().optional(),
  full_name: z.string().min(1).optional(),
  relation: z.string().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  occupation: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  is_billing_contact: z.boolean().optional(),
  can_pickup: z.boolean().optional(),
})

peopleRouter.post(
  '/students/:id/guardians',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = guardianLinkSchema.parse(req.body)
    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (student.rowCount === 0) throw notFound('Student not found')

    let guardianId = body.guardian_id
    if (!guardianId) {
      const { rows } = await pool.query(
        `INSERT INTO guardians (school_id, full_name, relation, phone, email, occupation, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          req.auth!.school_id,
          body.full_name ?? 'Guardian',
          body.relation ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.occupation ?? null,
          body.address ?? null,
        ],
      )
      guardianId = rows[0].id
    }

    await pool.query(
      `INSERT INTO guardianships (student_id, guardian_id, is_primary, is_billing_contact, can_pickup)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (student_id, guardian_id) DO UPDATE
         SET is_primary = EXCLUDED.is_primary,
             is_billing_contact = EXCLUDED.is_billing_contact,
             can_pickup = EXCLUDED.can_pickup`,
      [
        req.params.id,
        guardianId,
        body.is_primary ?? false,
        body.is_billing_contact ?? false,
        body.can_pickup ?? false,
      ],
    )
    res.status(201).json({ guardian_id: guardianId, student_id: req.params.id })
  }),
)

const guardianSchema = z.object({
  full_name: z.string().min(1),
  relation: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  occupation: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
})

peopleRouter.get(
  '/guardians',
  authenticate,
  requireRole('admin', 'registrar', 'accountant'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM guardians WHERE school_id = $1 ORDER BY full_name`, [
      req.auth!.school_id,
    ])
    res.json({ items: rows, total: rows.length })
  }),
)

peopleRouter.post(
  '/guardians',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = guardianSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO guardians (school_id, full_name, relation, phone, email, occupation, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.auth!.school_id, body.full_name, body.relation ?? null, body.phone ?? null, body.email ?? null, body.occupation ?? null, body.address ?? null],
    )
    res.status(201).json(rows[0])
  }),
)

peopleRouter.patch(
  '/guardians/:id',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = guardianSchema.partial().parse(req.body)
    const existing = await pool.query(`SELECT * FROM guardians WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (existing.rowCount === 0) throw notFound('Guardian not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE guardians SET full_name=$1, relation=$2, phone=$3, email=$4, occupation=$5, address=$6 WHERE id=$7`,
      [
        body.full_name ?? cur.full_name,
        body.relation !== undefined ? body.relation : cur.relation,
        body.phone !== undefined ? body.phone : cur.phone,
        body.email !== undefined ? body.email : cur.email,
        body.occupation !== undefined ? body.occupation : cur.occupation,
        body.address !== undefined ? body.address : cur.address,
        req.params.id,
      ],
    )
    res.json({ ok: true })
  }),
)

const staffSchema = z.object({
  employee_no: z.string().min(1),
  full_name: z.string().min(1),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  hired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
})

peopleRouter.get(
  '/staff',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT st.*, u.id AS user_id, u.email, u.full_name AS user_full_name, u.role
         FROM staff st LEFT JOIN users u ON u.id = st.user_id
        WHERE st.school_id = $1 ORDER BY st.full_name`,
      [req.auth!.school_id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

peopleRouter.post(
  '/staff',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = staffSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO staff (school_id, employee_no, full_name, designation, department, hired_on, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.auth!.school_id, body.employee_no, body.full_name, body.designation ?? null, body.department ?? null, body.hired_on ?? null, body.is_active ?? true],
    )
    res.status(201).json(rows[0])
  }),
)

peopleRouter.patch(
  '/staff/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = staffSchema.partial().parse(req.body)
    const existing = await pool.query(`SELECT * FROM staff WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (existing.rowCount === 0) throw notFound('Staff not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE staff SET employee_no=$1, full_name=$2, designation=$3, department=$4, hired_on=$5, is_active=$6 WHERE id=$7`,
      [
        body.employee_no ?? cur.employee_no,
        body.full_name ?? cur.full_name,
        body.designation !== undefined ? body.designation : cur.designation,
        body.department !== undefined ? body.department : cur.department,
        body.hired_on !== undefined ? body.hired_on : cur.hired_on,
        body.is_active ?? cur.is_active,
        req.params.id,
      ],
    )
    res.json({ ok: true })
  }),
)

peopleRouter.post(
  '/users/:id/deactivate',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (rows.length === 0) throw notFound('User not found')
    if (req.params.id === req.auth!.id) throw forbidden('Cannot deactivate your own account')
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [req.params.id])
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.params.id])
    res.json({ ok: true })
  }),
)
