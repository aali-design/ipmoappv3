import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { locked, notFound, unprocessable } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'
import { computeStudentGrades } from '../services/grading.js'

export const assessmentsRouter = Router()

const assessmentSchema = z.object({
  term_id: z.string().uuid(),
  section_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  max_score: z.number().positive(),
  weight_override_pct: z.number().positive().nullable().optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_published: z.boolean().optional(),
})

async function assertSectionAccess(auth: { role: string; staff_id?: string; school_id: string }, sectionId: string): Promise<void> {
  const res = await pool.query(
    `SELECT 1 FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
      WHERE sec.id = $1 AND ay.school_id = $2`,
    [sectionId, auth.school_id],
  )
  if (res.rowCount === 0) throw notFound('Section not found')
}

async function assertTeacherAssigned(staffId: string, sectionId: string, subjectId?: string): Promise<void> {
  const res = subjectId
    ? await pool.query(`SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2 AND subject_id = $3`, [sectionId, staffId, subjectId])
    : await pool.query(`SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2`, [sectionId, staffId])
  if (res.rowCount === 0) throw notFound('Not found')
}

assessmentsRouter.get(
  '/assessments',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const termId = req.query.termId as string | undefined
    const sectionId = req.query.sectionId as string | undefined
    const subjectId = req.query.subjectId as string | undefined

    const filters: string[] = ['ay.school_id = $1']
    const params: unknown[] = [req.auth!.school_id]
    if (termId) {
      params.push(termId)
      filters.push(`a.term_id = $${params.length}`)
    }
    if (sectionId) {
      params.push(sectionId)
      filters.push(`a.section_id = $${params.length}`)
    }
    if (subjectId) {
      params.push(subjectId)
      filters.push(`a.subject_id = $${params.length}`)
    }

    const { rows } = await pool.query(
      `SELECT a.*, c.name AS category_name, c.weight_pct, s.name AS subject_name, t.name AS term_name
         FROM assessments a
         JOIN sections sec ON sec.id = a.section_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id
         LEFT JOIN assessment_categories c ON c.id = a.category_id
         JOIN subjects s ON s.id = a.subject_id
         JOIN terms t ON t.id = a.term_id
        WHERE ${filters.join(' AND ')}
        ORDER BY a.title`,
      params,
    )
    res.json({ items: rows, total: rows.length })
  }),
)

assessmentsRouter.post(
  '/assessments',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = assessmentSchema.parse(req.body)
    await assertSectionAccess(req.auth!, body.section_id)
    if (req.auth!.role === 'teacher') await assertTeacherAssigned(req.auth!.staff_id!, body.section_id, body.subject_id)

    const { rows } = await pool.query(
      `INSERT INTO assessments (term_id, section_id, subject_id, category_id, title, max_score, weight_override_pct, due_on, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        body.term_id,
        body.section_id,
        body.subject_id,
        body.category_id ?? null,
        body.title,
        body.max_score,
        body.weight_override_pct ?? null,
        body.due_on ?? null,
        body.is_published ?? false,
        req.auth!.id,
      ],
    )
    res.status(201).json(rows[0])
  }),
)

assessmentsRouter.patch(
  '/assessments/:id',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = assessmentSchema.partial().parse(req.body)
    const existing = await pool.query(
      `SELECT a.*, ay.school_id FROM assessments a
         JOIN sections sec ON sec.id = a.section_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE a.id = $1`,
      [req.params.id],
    )
    if (existing.rowCount === 0) throw notFound('Assessment not found')
    const cur = existing.rows[0]
    if (cur.school_id !== req.auth!.school_id) throw notFound('Assessment not found')

    await pool.query(
      `UPDATE assessments SET title=$1, max_score=$2, weight_override_pct=$3, due_on=$4, is_published=$5, category_id=$6 WHERE id=$7`,
      [
        body.title ?? cur.title,
        body.max_score ?? cur.max_score,
        body.weight_override_pct !== undefined ? body.weight_override_pct : cur.weight_override_pct,
        body.due_on !== undefined ? body.due_on : cur.due_on,
        body.is_published ?? cur.is_published,
        body.category_id !== undefined ? body.category_id : cur.category_id,
        req.params.id,
      ],
    )
    res.json({ ok: true })
  }),
)

const marksSchema = z.object({
  marks: z.array(
    z.object({
      student_id: z.string().uuid(),
      score: z.number().min(0).nullable().optional(),
      is_absent: z.boolean().optional(),
      is_excused: z.boolean().optional(),
      remark: z.string().nullable().optional(),
    }),
  ),
  reason: z.string().optional(),
})

assessmentsRouter.put(
  '/assessments/:id/marks',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = marksSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const assessment = await pool.query(
      `SELECT a.*, sec.id AS section_id, ay.school_id, t.status AS term_status
         FROM assessments a
         JOIN sections sec ON sec.id = a.section_id
         JOIN academic_years ay ON ay.id = sec.academic_year_id
         JOIN terms t ON t.id = a.term_id
        WHERE a.id = $1`,
      [req.params.id],
    )
    if (assessment.rowCount === 0) throw notFound('Assessment not found')
    const a = assessment.rows[0]
    if (a.school_id !== schoolId) throw notFound('Assessment not found')

    if (req.auth!.role === 'teacher') await assertTeacherAssigned(req.auth!.staff_id!, a.section_id, a.subject_id)

    // Term lock (spec §3): locked term freezes marks unless admin overrides with a reason.
    if (a.term_status === 'locked') {
      if (req.auth!.role !== 'admin' || !body.reason) {
        throw locked('TermLocked', 'The term is locked; an admin override with a reason is required')
      }
    }

    const errors: { student_id: string; reason: string }[] = []
    for (const m of body.marks) {
      if (m.score != null && m.is_absent) {
        errors.push({ student_id: m.student_id, reason: 'absent XOR score: cannot be both' })
      } else if (m.score != null && m.score > Number(a.max_score)) {
        errors.push({ student_id: m.student_id, reason: `score exceeds max_score ${a.max_score}` })
      } else if (m.score == null && !m.is_absent && !m.is_excused) {
        errors.push({ student_id: m.student_id, reason: 'score or is_absent is required' })
      }
    }
    if (errors.length > 0) {
      throw unprocessable('Unprocessable', 'Some marks are invalid', { rows: errors })
    }

    for (const m of body.marks) {
      await pool.query(
        `INSERT INTO marks (assessment_id, student_id, score, is_absent, is_excused, remark, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (assessment_id, student_id) DO UPDATE
           SET score = EXCLUDED.score,
               is_absent = EXCLUDED.is_absent,
               is_excused = EXCLUDED.is_excused,
               remark = EXCLUDED.remark,
               entered_by = EXCLUDED.entered_by,
               updated_at = now()`,
        [req.params.id, m.student_id, m.score ?? null, m.is_absent ?? false, m.is_excused ?? false, m.remark ?? null, req.auth!.id],
      )
    }

    if (a.term_status === 'locked' && body.reason) {
      await writeAudit(pool, {
        schoolId,
        actorId: req.auth!.id,
        action: 'marks.edit_locked_term',
        entityType: 'assessment',
        entityId: req.params.id,
        metadata: { reason: body.reason },
      })
    }

    res.json({ ok: true })
  }),
)

assessmentsRouter.get(
  '/sections/:id/gradebook',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const sectionId = req.params.id
    const subjectId = req.query.subjectId as string
    const termId = req.query.termId as string

    await assertSectionAccess(req.auth!, sectionId)
    if (req.auth!.role === 'teacher') await assertTeacherAssigned(req.auth!.staff_id!, sectionId, subjectId)

    const assessmentsRes = await pool.query(
      `SELECT a.id, a.title, a.max_score, a.category_id, a.subject_id, a.is_published
         FROM assessments a WHERE a.section_id = $1 AND a.subject_id = $2 AND a.term_id = $3
         ORDER BY a.title`,
      [sectionId, subjectId, termId],
    )

    const rosterRes = await pool.query(
      `SELECT e.student_id, e.roll_no, s.first_name, s.last_name, s.admission_no
         FROM enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.section_id = $1 AND e.left_on IS NULL
        ORDER BY e.roll_no NULLS LAST, s.last_name`,
      [sectionId],
    )

    const marksRes = await pool.query(
      `SELECT m.assessment_id, m.student_id, m.score, m.is_absent, m.is_excused, m.remark
         FROM marks m JOIN assessments a ON a.id = m.assessment_id
        WHERE a.section_id = $1 AND a.subject_id = $2 AND a.term_id = $3`,
      [sectionId, subjectId, termId],
    )
    const marksByStudentAssessment = new Map<string, Record<string, unknown>>()
    for (const m of marksRes.rows) {
      const key = m.student_id as string
      let map = marksByStudentAssessment.get(key)
      if (!map) {
        map = {}
        marksByStudentAssessment.set(key, map)
      }
      map[m.assessment_id as string] = m
    }

    const rows = rosterRes.rows.map((r) => ({
      student_id: r.student_id,
      student_name: `${r.first_name} ${r.last_name}`,
      admission_no: r.admission_no,
      roll_no: r.roll_no,
      marks: marksByStudentAssessment.get(r.student_id as string) ?? {},
    }))

    res.json({
      assessments: assessmentsRes.rows,
      rows,
      term_id: termId,
      subject_id: subjectId,
      section_id: sectionId,
    })
  }),
)

assessmentsRouter.get(
  '/students/:id/grades',
  authenticate,
  asyncHandler(async (req, res) => {
    const termId = req.query.termId as string
    if (!termId) throw notFound('termId is required')

    const studentId = req.params.id
    const auth = req.auth!

    // Relationship scoping.
    const scoped = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [studentId, auth.school_id])
    if (scoped.rowCount === 0) throw notFound('Student not found')

    if (auth.role === 'guardian' && !auth.student_ids?.includes(studentId)) throw notFound('Student not found')
    if (auth.role === 'student' && auth.student_id !== studentId) throw notFound('Student not found')
    if (auth.role === 'teacher') {
      const assigned = await pool.query(
        `SELECT 1 FROM enrollments e JOIN teaching_assignments ta ON ta.section_id = e.section_id
          WHERE ta.teacher_id = $1 AND e.student_id = $2 AND e.left_on IS NULL`,
        [auth.staff_id, studentId],
      )
      if (assigned.rowCount === 0) throw notFound('Student not found')
    }

    const { grades, sectionId } = await computeStudentGrades(auth.school_id, studentId, termId)
    if (!grades) throw notFound('No grades found for the student in this term')

    const termRes = await pool.query(`SELECT name FROM terms WHERE id = $1`, [termId])
    res.json({ ...grades, term_name: termRes.rows[0]?.name ?? null, section_id: sectionId })
  }),
)
