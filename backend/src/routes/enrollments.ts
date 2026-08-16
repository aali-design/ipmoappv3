import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { conflict, notFound, unprocessable } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'

export const enrollmentsRouter = Router()

const enrollSchema = z.object({
  student_id: z.string().uuid(),
  section_id: z.string().uuid(),
  enrolled_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  roll_no: z.number().int().positive().optional(),
  allowOverflow: z.boolean().optional(),
  reason: z.string().optional(),
})

enrollmentsRouter.post(
  '/enrollments',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = enrollSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const sectionRes = await pool.query(
      `SELECT sec.* FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE sec.id = $1 AND ay.school_id = $2`,
      [body.section_id, schoolId],
    )
    if (sectionRes.rowCount === 0) throw notFound('Section not found')
    const section = sectionRes.rows[0]

    const studentRes = await pool.query(`SELECT id FROM students WHERE id = $1 AND school_id = $2`, [
      body.student_id,
      schoolId,
    ])
    if (studentRes.rowCount === 0) throw notFound('Student not found')

    const existing = await pool.query(
      `SELECT 1 FROM enrollments WHERE student_id = $1 AND academic_year_id = $2 AND left_on IS NULL`,
      [body.student_id, section.academic_year_id],
    )
    if ((existing.rowCount ?? 0) > 0) throw conflict('Student already has an active enrollment this academic year')

    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM enrollments WHERE section_id = $1 AND left_on IS NULL`,
      [body.section_id],
    )
    const count = Number(countRes.rows[0].n)
    if (count >= section.capacity) {
      if (!body.allowOverflow || !body.reason) {
        throw unprocessable('SectionFull', 'Section is at capacity', {
          capacity: section.capacity,
          current: count,
          allowOverflow: true,
        })
      }
    }

    const rollNo =
      body.roll_no ??
      (await pool.query(
        `SELECT COALESCE(max(roll_no), 0)::int + 1 AS next FROM enrollments WHERE section_id = $1 AND left_on IS NULL`,
        [body.section_id],
      )).rows[0].next

    const { rows } = await pool.query(
      `INSERT INTO enrollments (student_id, section_id, academic_year_id, enrolled_on, roll_no, status)
       VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
      [body.student_id, body.section_id, section.academic_year_id, body.enrolled_on ?? new Date().toISOString().slice(0, 10), rollNo],
    )

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'enrollment.create',
      entityType: 'enrollment',
      entityId: rows[0].id,
      metadata: body.allowOverflow ? { allowOverflow: true, reason: body.reason } : null,
    })

    res.status(201).json(rows[0])
  }),
)

const transferSchema = z.object({
  to_section_id: z.string().uuid(),
  reason: z.string().optional(),
  allowOverflow: z.boolean().optional(),
})

enrollmentsRouter.post(
  '/enrollments/:id/transfer',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT e.*, sec.academic_year_id FROM enrollments e
           JOIN sections sec ON sec.id = e.section_id
           JOIN academic_years ay ON ay.id = sec.academic_year_id
          WHERE e.id = $1 AND ay.school_id = $2 FOR UPDATE`,
        [req.params.id, schoolId],
      )
      if (current.rowCount === 0) throw notFound('Enrollment not found')
      const cur = current.rows[0]
      if (cur.left_on != null) throw conflict('Enrollment is already closed')

      const target = await client.query(
        `SELECT sec.* FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
          WHERE sec.id = $1 AND ay.school_id = $2`,
        [body.to_section_id, schoolId],
      )
      if (target.rowCount === 0) throw notFound('Target section not found')
      const tsec = target.rows[0]

      const countRes = await client.query(
        `SELECT count(*)::int AS n FROM enrollments WHERE section_id = $1 AND left_on IS NULL`,
        [body.to_section_id],
      )
      const count = Number(countRes.rows[0].n)
      if (count >= tsec.capacity && !(body.allowOverflow && body.reason)) {
        throw unprocessable('SectionFull', 'Target section is at capacity', {
          capacity: tsec.capacity,
          current: count,
        })
      }

      await client.query(
        `UPDATE enrollments SET left_on = $1, status = 'transferred' WHERE id = $2`,
        [new Date().toISOString().slice(0, 10), cur.id],
      )

      const rollNo = (
        await client.query(
          `SELECT COALESCE(max(roll_no), 0)::int + 1 AS next FROM enrollments WHERE section_id = $1 AND left_on IS NULL`,
          [body.to_section_id],
        )
      ).rows[0].next

      const inserted = await client.query(
        `INSERT INTO enrollments (student_id, section_id, academic_year_id, enrolled_on, roll_no, status)
         VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
        [cur.student_id, body.to_section_id, tsec.academic_year_id, new Date().toISOString().slice(0, 10), rollNo],
      )
      return inserted.rows[0]
    })

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'enrollment.transfer',
      entityType: 'enrollment',
      entityId: req.params.id,
      metadata: { to_section_id: body.to_section_id, reason: body.reason ?? null },
    })

    res.status(201).json(result)
  }),
)

const promoteSchema = z.object({
  from_academic_year_id: z.string().uuid(),
  to_academic_year_id: z.string().uuid(),
})

enrollmentsRouter.post(
  '/enrollments/bulk-promote',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = promoteSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const decisions = await pool.query(
      `SELECT pd.student_id, pd.decision, pd.to_grade_level_id, e.section_id, sec.grade_level_id AS current_grade
         FROM promotion_decisions pd
         JOIN enrollments e ON e.student_id = pd.student_id AND e.academic_year_id = pd.academic_year_id AND e.left_on IS NULL
         JOIN sections sec ON sec.id = e.section_id
        WHERE pd.academic_year_id = $1 AND pd.decision IN ('promoted','repeated')
          AND NOT EXISTS (
            SELECT 1 FROM enrollments e2 WHERE e2.student_id = pd.student_id AND e2.academic_year_id = $2 AND e2.left_on IS NULL
          )`,
      [body.from_academic_year_id, body.to_academic_year_id],
    )

    let promoted = 0
    let skipped = 0

    await withTransaction(async (client) => {
      for (const d of decisions.rows) {
        const targetGrade =
          d.decision === 'promoted' ? (d.to_grade_level_id ?? d.current_grade) : d.current_grade
        const sectionRes = await client.query(
          `SELECT id FROM sections WHERE academic_year_id = $1 AND grade_level_id = $2 ORDER BY name LIMIT 1`,
          [body.to_academic_year_id, targetGrade],
        )
        if (sectionRes.rowCount === 0) {
          skipped++
          continue
        }
        const rollNo = (
          await client.query(
            `SELECT COALESCE(max(roll_no), 0)::int + 1 AS next FROM enrollments WHERE section_id = $1 AND left_on IS NULL`,
            [sectionRes.rows[0].id],
          )
        ).rows[0].next

        await client.query(
          `INSERT INTO enrollments (student_id, section_id, academic_year_id, enrolled_on, roll_no, status)
           VALUES ($1,$2,$3,$4,$5,'active')`,
          [d.student_id, sectionRes.rows[0].id, body.to_academic_year_id, new Date().toISOString().slice(0, 10), rollNo],
        )
        promoted++
      }
    })

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'enrollment.bulk_promote',
      metadata: { promoted, skipped },
    })

    res.json({ promoted, skipped })
  }),
)

enrollmentsRouter.get(
  '/sections/:id/roster',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const schoolId = req.auth!.school_id
    const sectionOwned = await pool.query(
      `SELECT 1 FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE sec.id = $1 AND ay.school_id = $2`,
      [req.params.id, schoolId],
    )
    if (sectionOwned.rowCount === 0) throw notFound('Section not found')

    if (req.auth!.role === 'teacher') {
      const assigned = await pool.query(
        `SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2`,
        [req.params.id, req.auth!.staff_id],
      )
      if (assigned.rowCount === 0) throw notFound('Section not found')
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.student_id, e.roll_no, e.status,
              s.first_name, s.last_name, s.admission_no, s.gender
         FROM enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.section_id = $1 AND e.left_on IS NULL
        ORDER BY e.roll_no NULLS LAST, s.last_name`,
      [req.params.id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)
