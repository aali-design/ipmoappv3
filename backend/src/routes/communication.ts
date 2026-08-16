import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { notFound } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'

export const communicationRouter = Router()

const audienceSchema = z.object({
  roles: z.array(z.enum(['admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian'])).optional(),
  grade_level_ids: z.array(z.string().uuid()).optional(),
  section_ids: z.array(z.string().uuid()).optional(),
  student_ids: z.array(z.string().uuid()).optional(),
})

const announcementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience: audienceSchema.optional(),
  publish_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
})

async function resolveAudienceKeys(auth: { school_id: string; role: string; student_ids?: string[] }): Promise<{
  role: string
  studentIds: string[]
  sectionIds: string[]
  gradeIds: string[]
}> {
  const studentIds = auth.student_ids ?? []
  let sectionIds: string[] = []
  let gradeIds: string[] = []
  if (studentIds.length > 0) {
    const res = await pool.query(
      `SELECT DISTINCT e.section_id, sec.grade_level_id
         FROM enrollments e JOIN sections sec ON sec.id = e.section_id
        WHERE e.student_id = ANY($1::uuid[]) AND e.left_on IS NULL`,
      [studentIds],
    )
    sectionIds = res.rows.map((r) => r.section_id as string)
    gradeIds = res.rows.map((r) => r.grade_level_id as string)
  }
  return { role: auth.role, studentIds, sectionIds, gradeIds }
}

communicationRouter.get(
  '/announcements',
  authenticate,
  asyncHandler(async (req, res) => {
    const keys = await resolveAudienceKeys(req.auth!)
    const now = new Date().toISOString()

    const { rows } = await pool.query(
      `SELECT * FROM announcements WHERE school_id = $1
         AND (publish_at IS NULL OR publish_at <= now())
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY COALESCE(publish_at, created_at) DESC`,
      [req.auth!.school_id],
    )

    const items = rows
      .filter((a) => {
        const audience = (a.audience_json ?? {}) as {
          roles?: string[]
          grade_level_ids?: string[]
          section_ids?: string[]
          student_ids?: string[]
        }
        if (Object.keys(audience).length === 0) return true
        if (audience.roles?.includes(keys.role)) return true
        if (audience.student_ids?.some((id) => keys.studentIds.includes(id))) return true
        if (audience.grade_level_ids?.some((id) => keys.gradeIds.includes(id))) return true
        if (audience.section_ids?.some((id) => keys.sectionIds.includes(id))) return true
        return false
      })
      .map((a) => ({
        ...a,
        audience_json: a.audience_json,
      }))

    res.json({ items, total: items.length })
  }),
)

communicationRouter.post(
  '/announcements',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = announcementSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO announcements (school_id, title, body, audience_json, publish_at, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.auth!.school_id,
        body.title,
        body.body,
        JSON.stringify(body.audience ?? {}),
        body.publish_at ?? null,
        body.expires_at ?? null,
        req.auth!.id,
      ],
    )
    res.status(201).json(rows[0])
  }),
)

communicationRouter.post(
  '/announcements/:id/read',
  authenticate,
  asyncHandler(async (req, res) => {
    await pool.query(
      `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1,$2)
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [req.params.id, req.auth!.id],
    )
    res.json({ ok: true })
  }),
)

const incidentSchema = z.object({
  student_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['behavior', 'merit', 'health', 'other']),
  severity: z.string().nullable().optional(),
  description: z.string().min(1),
  action_taken: z.string().nullable().optional(),
  guardian_notified_at: z.string().nullable().optional(),
})

communicationRouter.get(
  '/incidents',
  authenticate,
  requireRole('admin', 'registrar', 'teacher', 'student', 'guardian'),
  asyncHandler(async (req, res) => {
    const auth = req.auth!
    let where = `i.student_id IN (SELECT id FROM students WHERE school_id = $1)`
    const params: unknown[] = [auth.school_id]
    if (auth.role === 'guardian' && auth.student_ids) {
      params.push(auth.student_ids)
      where = `i.student_id = ANY($${params.length}::uuid[])`
    } else if (auth.role === 'student') {
      params.push(auth.student_id)
      where = `i.student_id = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT i.*, s.first_name, s.last_name FROM incidents i JOIN students s ON s.id = i.student_id
        WHERE ${where} ORDER BY i.date DESC`,
      params,
    )
    res.json({ items: rows, total: rows.length })
  }),
)

communicationRouter.post(
  '/incidents',
  authenticate,
  requireRole('admin', 'registrar', 'teacher'),
  asyncHandler(async (req, res) => {
    const body = incidentSchema.parse(req.body)
    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [
      body.student_id,
      req.auth!.school_id,
    ])
    if (student.rowCount === 0) throw notFound('Student not found')

    const { rows } = await pool.query(
      `INSERT INTO incidents (student_id, date, category, severity, description, action_taken, reported_by, guardian_notified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        body.student_id,
        body.date,
        body.category,
        body.severity ?? null,
        body.description,
        body.action_taken ?? null,
        req.auth!.id,
        body.guardian_notified_at ?? null,
      ],
    )
    await writeAudit(pool, {
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      action: 'incident.create',
      entityType: 'incident',
      entityId: rows[0].id,
    })
    res.status(201).json(rows[0])
  }),
)
