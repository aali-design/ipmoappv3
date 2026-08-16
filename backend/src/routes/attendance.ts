import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { locked, notFound, unprocessable } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'
import { getSchoolAttendancePolicy } from '../services/reportCards.js'
import { DEFAULT_LATE_EQUALS_ABSENT, DEFAULT_MIN_ATTENDANCE_PCT } from '../engines/attendance.js'

export const attendanceRouter = Router()

async function getSchoolSettings(schoolId: string): Promise<Record<string, unknown>> {
  const res = await pool.query(`SELECT settings_json FROM schools WHERE id = $1`, [schoolId])
  return (res.rows[0]?.settings_json ?? {}) as Record<string, unknown>
}

function isHoliday(settings: Record<string, unknown>, date: string): boolean {
  const holidays = (settings.holidays ?? []) as string[]
  return holidays.includes(date)
}

const sessionSchema = z.object({
  section_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  timetable_slot_id: z.string().uuid().nullable().optional(),
})

attendanceRouter.post(
  '/attendance/sessions',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = sessionSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const sectionRes = await pool.query(
      `SELECT sec.id, sec.academic_year_id, ay.starts_on, ay.ends_on
         FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE sec.id = $1 AND ay.school_id = $2`,
      [body.section_id, schoolId],
    )
    if (sectionRes.rowCount === 0) throw notFound('Section not found')
    const section = sectionRes.rows[0]

    // Teacher must be assigned to the section (spec §5).
    if (req.auth!.role === 'teacher') {
      const assigned = await pool.query(
        `SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2`,
        [body.section_id, req.auth!.staff_id],
      )
      if (assigned.rowCount === 0) throw notFound('Section not found')
    }

    const termRes = await pool.query(
      `SELECT t.id FROM terms t WHERE t.academic_year_id = $1
         AND $2::date BETWEEN t.starts_on AND t.ends_on LIMIT 1`,
      [section.academic_year_id, body.date],
    )
    if (termRes.rowCount === 0) {
      throw unprocessable('Unprocessable', 'The date is outside the academic term', { date: body.date })
    }

    const settings = await getSchoolSettings(schoolId)
    if (isHoliday(settings, body.date)) {
      throw unprocessable('Unprocessable', 'The date is a school holiday', { date: body.date })
    }

    const dailyMode = settings.attendanceMode === 'daily'
    const periodId = dailyMode ? null : (body.period_id ?? null)

    if (!dailyMode && !periodId) {
      throw unprocessable('Unprocessable', 'period_id is required in per-period attendance mode')
    }

    const existing = await pool.query(
      `SELECT id FROM attendance_sessions WHERE section_id = $1 AND date = $2 AND period_id IS NOT DISTINCT FROM $3`,
      [body.section_id, body.date, periodId],
    )
    if ((existing.rowCount ?? 0) > 0) {
      return res.json(existing.rows[0])
    }

    const { rows } = await pool.query(
      `INSERT INTO attendance_sessions (section_id, subject_id, date, period_id, timetable_slot_id, taken_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [body.section_id, body.subject_id ?? null, body.date, periodId, body.timetable_slot_id ?? null, req.auth!.id],
    )
    res.status(201).json(rows[0])
  }),
)

const recordsSchema = z.object({
  records: z.array(
    z.object({
      student_id: z.string().uuid(),
      status: z.enum(['present', 'absent', 'late', 'excused', 'sick']),
      minutes_late: z.number().int().min(0).optional(),
      remark: z.string().nullable().optional(),
    }),
  ),
  reason: z.string().optional(),
})

attendanceRouter.put(
  '/attendance/sessions/:id/records',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = recordsSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const sessionRes = await pool.query(
      `SELECT asess.*, sec.academic_year_id, ay.school_id
         FROM attendance_sessions asess
         JOIN sections sec ON sec.id = asess.section_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE asess.id = $1`,
      [req.params.id],
    )
    if (sessionRes.rowCount === 0) throw notFound('Session not found')
    const session = sessionRes.rows[0]
    if (session.school_id !== schoolId) throw notFound('Session not found')

    if (req.auth!.role === 'teacher') {
      const assigned = await pool.query(
        `SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2`,
        [session.section_id, req.auth!.staff_id],
      )
      if (assigned.rowCount === 0) throw notFound('Session not found')
    }

    const isLocked = session.is_finalized
    if (isLocked) {
      const allowEdit = req.auth!.role === 'admin' || body.reason
      if (!allowEdit) {
        throw locked('Locked', 'Session is finalized; provide a reason to edit')
      }
    }

    // Validate term lock: cannot edit a locked term without admin reason.
    const termRes = await pool.query(
      `SELECT t.id, t.status FROM terms t WHERE t.academic_year_id = $1
         AND $2::date BETWEEN t.starts_on AND t.ends_on LIMIT 1`,
      [session.academic_year_id, session.date],
    )
    if ((termRes.rowCount ?? 0) > 0 && termRes.rows[0].status === 'locked' && req.auth!.role !== 'admin') {
      throw locked('TermLocked', 'The term is locked; an admin override is required')
    }

    for (const rec of body.records) {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, status, minutes_late, remark)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, student_id) DO UPDATE
           SET status = EXCLUDED.status,
               minutes_late = EXCLUDED.minutes_late,
               remark = EXCLUDED.remark`,
        [session.id, rec.student_id, rec.status, rec.minutes_late ?? 0, rec.remark ?? null],
      )
    }

    if (isLocked && body.reason) {
      await writeAudit(pool, {
        schoolId,
        actorId: req.auth!.id,
        action: 'attendance.edit_finalized',
        entityType: 'attendance_session',
        entityId: session.id,
        metadata: { reason: body.reason },
      })
    }

    res.json({ ok: true })
  }),
)

attendanceRouter.post(
  '/attendance/sessions/:id/finalize',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT asess.id, ay.school_id FROM attendance_sessions asess
         JOIN sections sec ON sec.id = asess.section_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE asess.id = $1`,
      [req.params.id],
    )
    if (rows.length === 0) throw notFound('Session not found')
    if (rows[0].school_id !== req.auth!.school_id) throw notFound('Session not found')

    await pool.query(`UPDATE attendance_sessions SET is_finalized = true WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  }),
)

attendanceRouter.get(
  '/attendance/summary',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian'),
  asyncHandler(async (req, res) => {
    const scope = (req.query.scope as string) ?? 'section'
    const termId = req.query.termId as string
    const sectionId = req.query.sectionId as string | undefined
    const studentId = req.query.studentId as string | undefined
    const gradeId = req.query.gradeId as string | undefined

    if (!termId) throw notFound('termId is required')

    const policy = await getSchoolAttendancePolicy(req.auth!.school_id)
    const lateEq = policy.lateEqualsAbsent || DEFAULT_LATE_EQUALS_ABSENT

    const filters: string[] = []
    const params: unknown[] = [termId]
    let pi = 2

    if (scope === 'section' && sectionId) {
      filters.push(`sec.id = $${++pi}`)
      params.push(sectionId)
    } else if (scope === 'student' && studentId) {
      filters.push(`ar.student_id = $${++pi}`)
      params.push(studentId)
    } else if (scope === 'grade' && gradeId) {
      filters.push(`sec.grade_level_id = $${++pi}`)
      params.push(gradeId)
    }

    const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

    const { rows } = await pool.query(
      `SELECT ar.student_id, s.first_name, s.last_name, s.admission_no,
              count(*)::int AS total,
              count(*) FILTER (WHERE ar.status = 'present')::int AS present,
              count(*) FILTER (WHERE ar.status = 'absent')::int AS absent,
              count(*) FILTER (WHERE ar.status = 'late')::int AS late,
              count(*) FILTER (WHERE ar.status = 'excused')::int AS excused,
              count(*) FILTER (WHERE ar.status = 'sick')::int AS sick,
              round(
                (count(*) - (count(*) FILTER (WHERE ar.status = 'absent') + (count(*) FILTER (WHERE ar.status = 'late') / $1::int))) * 100.0 / NULLIF(count(*), 0),
                2
              ) AS percentage
         FROM attendance_records ar
         JOIN attendance_sessions asess ON asess.id = ar.session_id
         JOIN students s ON s.id = ar.student_id
         JOIN sections sec ON sec.id = asess.section_id
         JOIN terms t ON t.id = $2::uuid
        WHERE asess.date BETWEEN (SELECT starts_on FROM terms WHERE id = $2::uuid) AND (SELECT ends_on FROM terms WHERE id = $2::uuid)
          ${where}
        GROUP BY ar.student_id, s.first_name, s.last_name, s.admission_no
        ORDER BY s.last_name, s.first_name`,
      [lateEq, termId, ...params.slice(1)],
    )

    const items = rows.map((r) => ({
      student_id: r.student_id,
      student_name: `${r.first_name} ${r.last_name}`,
      admission_no: r.admission_no,
      scope,
      term_id: termId,
      section_id: sectionId ?? null,
      present: Number(r.present),
      absent: Number(r.absent),
      late: Number(r.late),
      excused: Number(r.excused),
      sick: Number(r.sick),
      total: Number(r.total),
      percentage: Number(r.percentage),
      attendance_pct: Number(r.percentage),
    }))

    res.json({ items, total: items.length })
  }),
)

attendanceRouter.get(
  '/attendance/warnings',
  authenticate,
  requireRole('admin', 'registrar', 'teacher'),
  asyncHandler(async (req, res) => {
    const schoolId = req.auth!.school_id
    const settings = await getSchoolSettings(schoolId)
    const minPct = (settings.minAttendancePct as number) ?? DEFAULT_MIN_ATTENDANCE_PCT
    const lateEq = (settings.lateEqualsAbsentCount as number) ?? DEFAULT_LATE_EQUALS_ABSENT
    const termId = req.query.termId as string | undefined

    const params: unknown[] = [schoolId]
    let termCond = ''
    if (termId) {
      params.push(termId)
      termCond = `AND asess.date BETWEEN (SELECT starts_on FROM terms WHERE id = $2::uuid) AND (SELECT ends_on FROM terms WHERE id = $2::uuid)`
    }
    params.push(lateEq, minPct)

    const { rows } = await pool.query(
      `WITH counts AS (
         SELECT ar.student_id, s.first_name, s.last_name,
                count(*)::int AS total,
                count(*) FILTER (WHERE ar.status = 'absent')::int AS absent,
                count(*) FILTER (WHERE ar.status = 'late')::int AS late
           FROM attendance_records ar
           JOIN attendance_sessions asess ON asess.id = ar.session_id
           JOIN students s ON s.id = ar.student_id
          WHERE s.school_id = $1 ${termCond}
          GROUP BY ar.student_id, s.first_name, s.last_name
       )
       SELECT *, round((total - (absent + (late / $3::int))) * 100.0 / NULLIF(total, 0), 2) AS attendance_pct
         FROM counts
        WHERE round((total - (absent + (late / $3::int))) * 100.0 / NULLIF(total, 0), 2) < $4::numeric
        ORDER BY attendance_pct`,
      params,
    )

    res.json({
      items: rows.map((r) => ({
        student_id: r.student_id,
        student_name: `${r.first_name} ${r.last_name}`,
        attendance_pct: Number(r.attendance_pct),
        total: Number(r.total),
        absent: Number(r.absent),
        late: Number(r.late),
        warning_type: 'exam_ineligible',
      })),
      total: rows.length,
    })
  }),
)
