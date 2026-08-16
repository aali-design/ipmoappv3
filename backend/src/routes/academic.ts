import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { invalidTransition, locked, notFound, unprocessable } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'

export const academicRouter = Router()

const schoolPatchSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().optional(),
  address: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
})

academicRouter.get(
  '/school',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, slug, timezone, currency, locale, address, logo_url, settings_json FROM schools WHERE id = $1`,
      [req.auth!.school_id],
    )
    const s = rows[0]
    if (!s) throw notFound('School not found')
    res.json({
      id: s.id,
      name: s.name,
      slug: s.slug,
      timezone: s.timezone,
      currency: s.currency,
      locale: s.locale,
      address: s.address,
      logo_url: s.logo_url,
      settings_json: s.settings_json,
    })
  }),
)

academicRouter.patch(
  '/school',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = schoolPatchSchema.parse(req.body)
    const { rows } = await pool.query(
      `SELECT id, name, timezone, currency, locale, address, logo_url, settings_json FROM schools WHERE id = $1`,
      [req.auth!.school_id],
    )
    const cur = rows[0]
    if (!cur) throw notFound('School not found')

    const name = body.name ?? cur.name
    const timezone = body.timezone ?? cur.timezone
    const currency = body.currency ?? cur.currency
    const locale = body.locale ?? cur.locale
    const address = body.address !== undefined ? body.address : cur.address
    const logoUrl = body.logo_url !== undefined ? body.logo_url : cur.logo_url
    const settingsJson = body.settings !== undefined ? body.settings : cur.settings_json

    await pool.query(
      `UPDATE schools SET name=$1, timezone=$2, currency=$3, locale=$4, address=$5, logo_url=$6, settings_json=$7 WHERE id=$8`,
      [name, timezone, currency, locale, address, logoUrl, JSON.stringify(settingsJson), req.auth!.school_id],
    )
    await writeAudit(pool, { schoolId: req.auth!.school_id, actorId: req.auth!.id, action: 'school.update' })
    res.json({ ok: true })
  }),
)

const yearSchema = z.object({
  name: z.string().min(1),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

academicRouter.get(
  '/academic-years',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, school_id, name, starts_on, ends_on, is_current, status
         FROM academic_years WHERE school_id = $1 ORDER BY starts_on DESC`,
      [req.auth!.school_id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/academic-years',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = yearSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO academic_years (school_id, name, starts_on, ends_on)
       VALUES ($1,$2,$3,$4) RETURNING id, school_id, name, starts_on, ends_on, is_current, status`,
      [req.auth!.school_id, body.name, body.starts_on, body.ends_on],
    )
    res.status(201).json(rows[0])
  }),
)

academicRouter.patch(
  '/academic-years/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = yearSchema.partial().parse(req.body)
    const existing = await pool.query(`SELECT * FROM academic_years WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (existing.rowCount === 0) throw notFound('Academic year not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE academic_years SET name=$1, starts_on=$2, ends_on=$3 WHERE id=$4`,
      [body.name ?? cur.name, body.starts_on ?? cur.starts_on, body.ends_on ?? cur.ends_on, req.params.id],
    )
    res.json({ ok: true })
  }),
)

academicRouter.post(
  '/academic-years/:id/activate',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM academic_years WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [req.params.id, req.auth!.school_id],
      )
      if (rows.length === 0) throw notFound('Academic year not found')
      const year = rows[0]
      if (year.status === 'closed') throw locked('YearClosed', 'A closed academic year cannot be reactivated')
      await client.query(`UPDATE academic_years SET is_current = false WHERE school_id = $1`, [req.auth!.school_id])
      await client.query(`UPDATE academic_years SET is_current = true, status = 'active' WHERE id = $1`, [req.params.id])
    })
    await writeAudit(pool, {
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      action: 'academic_year.activate',
      entityType: 'academic_year',
      entityId: req.params.id,
    })
    res.json({ ok: true })
  }),
)

academicRouter.post(
  '/academic-years/:id/close',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM academic_years WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [req.params.id, req.auth!.school_id],
      )
      if (rows.length === 0) throw notFound('Academic year not found')

      const unlockedTerms = await client.query(
        `SELECT count(*)::int AS n FROM terms WHERE academic_year_id = $1 AND status <> 'locked'`,
        [req.params.id],
      )
      if (Number(unlockedTerms.rows[0].n) > 0) {
        throw unprocessable('YearClosed', 'All terms must be locked before closing the year', { unlockedTerms: Number(unlockedTerms.rows[0].n) })
      }

      const missingDecisions = await client.query(
        `SELECT count(*)::int AS n
           FROM enrollments e
          WHERE e.academic_year_id = $1 AND e.left_on IS NULL
            AND NOT EXISTS (SELECT 1 FROM promotion_decisions pd WHERE pd.student_id = e.student_id AND pd.academic_year_id = $1)`,
        [req.params.id],
      )
      if (Number(missingDecisions.rows[0].n) > 0) {
        throw unprocessable('YearClosed', 'Every enrolled student must have a promotion decision before closing', {
          missingDecisions: Number(missingDecisions.rows[0].n),
        })
      }

      await client.query(`UPDATE academic_years SET status = 'closed', is_current = false WHERE id = $1`, [req.params.id])
    })
    await writeAudit(pool, {
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      action: 'academic_year.close',
      entityType: 'academic_year',
      entityId: req.params.id,
    })
    res.json({ ok: true })
  }),
)

const termSchema = z.object({
  academic_year_id: z.string().uuid(),
  name: z.string().min(1),
  sequence: z.number().int().positive(),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

academicRouter.get(
  '/terms',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const yearId = req.query.academicYearId as string | undefined
    const { rows } = await pool.query(
      `SELECT t.* FROM terms t
         JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE ay.school_id = $1 AND ($2::uuid IS NULL OR t.academic_year_id = $2::uuid)
        ORDER BY t.sequence`,
      [req.auth!.school_id, yearId ?? null],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/terms',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = termSchema.parse(req.body)
    await assertYearOwned(body.academic_year_id, req.auth!.school_id)
    const { rows } = await pool.query(
      `INSERT INTO terms (academic_year_id, name, sequence, starts_on, ends_on)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.academic_year_id, body.name, body.sequence, body.starts_on, body.ends_on],
    )
    res.status(201).json(rows[0])
  }),
)

academicRouter.patch(
  '/terms/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = termSchema.partial().omit({ academic_year_id: true }).parse(req.body)
    const existing = await pool.query(
      `SELECT t.* FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE t.id = $1 AND ay.school_id = $2`,
      [req.params.id, req.auth!.school_id],
    )
    if (existing.rowCount === 0) throw notFound('Term not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE terms SET name=$1, sequence=$2, starts_on=$3, ends_on=$4 WHERE id=$5`,
      [body.name ?? cur.name, body.sequence ?? cur.sequence, body.starts_on ?? cur.starts_on, body.ends_on ?? cur.ends_on, req.params.id],
    )
    res.json({ ok: true })
  }),
)

academicRouter.post(
  '/terms/:id/lock',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.* FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE t.id = $1 AND ay.school_id = $2 FOR UPDATE`,
      [req.params.id, req.auth!.school_id],
    )
    if (rows.length === 0) throw notFound('Term not found')
    const term = rows[0]
    if (term.status === 'locked') throw invalidTransition('locked', 'locked', ['active', 'planning'])
    await pool.query(`UPDATE terms SET status = 'locked' WHERE id = $1`, [req.params.id])
    await writeAudit(pool, {
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      action: 'term.lock',
      entityType: 'term',
      entityId: req.params.id,
    })
    res.json({ ok: true })
  }),
)

const gradeLevelSchema = z.object({ name: z.string().min(1), sequence: z.number().int() })

academicRouter.get(
  '/grade-levels',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, school_id, name, sequence FROM grade_levels WHERE school_id = $1 ORDER BY sequence`,
      [req.auth!.school_id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/grade-levels',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = gradeLevelSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO grade_levels (school_id, name, sequence) VALUES ($1,$2,$3) RETURNING *`,
      [req.auth!.school_id, body.name, body.sequence],
    )
    res.status(201).json(rows[0])
  }),
)

const sectionSchema = z.object({
  academic_year_id: z.string().uuid(),
  grade_level_id: z.string().uuid(),
  name: z.string().min(1),
  capacity: z.number().int().positive(),
  homeroom_teacher_id: z.string().uuid().nullable().optional(),
})

academicRouter.get(
  '/sections',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const yearId = req.query.academicYearId as string | undefined
    const { rows } = await pool.query(
      `SELECT s.*, gl.name AS grade_name, gl.sequence AS grade_sequence, ay.name AS year_name
         FROM sections s
         JOIN grade_levels gl ON gl.id = s.grade_level_id
         JOIN academic_years ay ON ay.id = s.academic_year_id
        WHERE ay.school_id = $1 AND ($2::uuid IS NULL OR s.academic_year_id = $2::uuid)
        ORDER BY gl.sequence, s.name`,
      [req.auth!.school_id, yearId ?? null],
    )
    res.json({
      items: rows.map((r) => ({
        ...r,
        grade_level: { name: r.grade_name, sequence: r.grade_sequence },
        academic_year: { name: r.year_name },
      })),
      total: rows.length,
    })
  }),
)

academicRouter.post(
  '/sections',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = sectionSchema.parse(req.body)
    await assertYearOwned(body.academic_year_id, req.auth!.school_id)
    const { rows } = await pool.query(
      `INSERT INTO sections (academic_year_id, grade_level_id, name, capacity, homeroom_teacher_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.academic_year_id, body.grade_level_id, body.name, body.capacity, body.homeroom_teacher_id ?? null],
    )
    res.status(201).json(rows[0])
  }),
)

academicRouter.patch(
  '/sections/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = sectionSchema.partial().omit({ academic_year_id: true }).parse(req.body)
    const existing = await pool.query(
      `SELECT s.* FROM sections s JOIN academic_years ay ON ay.id = s.academic_year_id
        WHERE s.id = $1 AND ay.school_id = $2`,
      [req.params.id, req.auth!.school_id],
    )
    if (existing.rowCount === 0) throw notFound('Section not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE sections SET grade_level_id=$1, name=$2, capacity=$3, homeroom_teacher_id=$4 WHERE id=$5`,
      [
        body.grade_level_id ?? cur.grade_level_id,
        body.name ?? cur.name,
        body.capacity ?? cur.capacity,
        body.homeroom_teacher_id !== undefined ? body.homeroom_teacher_id : cur.homeroom_teacher_id,
        req.params.id,
      ],
    )
    res.json({ ok: true })
  }),
)

const subjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  is_elective: z.boolean().optional(),
  credit_hours: z.number().positive().optional(),
})

academicRouter.get(
  '/subjects',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, school_id, code, name, is_elective, credit_hours FROM subjects WHERE school_id = $1 ORDER BY name`,
      [req.auth!.school_id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/subjects',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = subjectSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO subjects (school_id, code, name, is_elective, credit_hours)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.auth!.school_id, body.code, body.name, body.is_elective ?? false, body.credit_hours ?? 1],
    )
    res.status(201).json(rows[0])
  }),
)

const roomSchema = z.object({
  name: z.string().min(1),
  capacity: z.number().int().positive().nullable().optional(),
  kind: z.enum(['classroom', 'lab', 'gym', 'hall']).optional(),
})

academicRouter.get(
  '/rooms',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM rooms WHERE school_id = $1 ORDER BY name`, [req.auth!.school_id])
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/rooms',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = roomSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO rooms (school_id, name, capacity, kind) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.auth!.school_id, body.name, body.capacity ?? null, body.kind ?? 'classroom'],
    )
    res.status(201).json(rows[0])
  }),
)

const periodSchema = z.object({
  academic_year_id: z.string().uuid(),
  sequence: z.number().int().positive(),
  label: z.string().min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  is_break: z.boolean().optional(),
})

academicRouter.get(
  '/periods',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const yearId = req.query.academicYearId as string | undefined
    const { rows } = await pool.query(
      `SELECT p.* FROM periods p JOIN academic_years ay ON ay.id = p.academic_year_id
        WHERE ay.school_id = $1 AND ($2::uuid IS NULL OR p.academic_year_id = $2::uuid)
        ORDER BY p.sequence`,
      [req.auth!.school_id, yearId ?? null],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/periods',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = periodSchema.parse(req.body)
    await assertYearOwned(body.academic_year_id, req.auth!.school_id)
    const { rows } = await pool.query(
      `INSERT INTO periods (academic_year_id, sequence, label, starts_at, ends_at, is_break)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [body.academic_year_id, body.sequence, body.label, body.starts_at, body.ends_at, body.is_break ?? false],
    )
    res.status(201).json(rows[0])
  }),
)

const scaleSchema = z.object({
  name: z.string().min(1),
  bands: z.array(
    z.object({
      min: z.number(),
      max: z.number(),
      letter: z.string(),
      gpa: z.number(),
      remark: z.string().optional(),
    }),
  ),
  is_default: z.boolean().optional(),
})

academicRouter.get(
  '/grading-scales',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM grading_scales WHERE school_id = $1 ORDER BY name`, [
      req.auth!.school_id,
    ])
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/grading-scales',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = scaleSchema.parse(req.body)
    await withTransaction(async (client) => {
      if (body.is_default) {
        await client.query(`UPDATE grading_scales SET is_default = false WHERE school_id = $1`, [req.auth!.school_id])
      }
      const { rows } = await client.query(
        `INSERT INTO grading_scales (school_id, name, bands_json, is_default)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.auth!.school_id, body.name, JSON.stringify(body.bands), body.is_default ?? false],
      )
      res.status(201).json(rows[0])
    })
  }),
)

academicRouter.patch(
  '/grading-scales/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = scaleSchema.partial().parse(req.body)
    const existing = await pool.query(`SELECT * FROM grading_scales WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (existing.rowCount === 0) throw notFound('Grading scale not found')
    const cur = existing.rows[0]
    await pool.query(
      `UPDATE grading_scales SET name=$1, bands_json=$2, is_default=$3 WHERE id=$4`,
      [body.name ?? cur.name, body.bands ? JSON.stringify(body.bands) : cur.bands_json, body.is_default ?? cur.is_default, req.params.id],
    )
    res.json({ ok: true })
  }),
)

const categorySchema = z.object({
  academic_year_id: z.string().uuid(),
  name: z.string().min(1),
  weight_pct: z.number().min(0).max(100),
  drop_lowest: z.number().int().min(0).optional(),
  applies_to_subject_id: z.string().uuid().nullable().optional(),
})

academicRouter.get(
  '/assessment-categories',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const yearId = req.query.academicYearId as string | undefined
    const { rows } = await pool.query(
      `SELECT c.* FROM assessment_categories c JOIN academic_years ay ON ay.id = c.academic_year_id
        WHERE ay.school_id = $1 AND ($2::uuid IS NULL OR c.academic_year_id = $2::uuid)
        ORDER BY c.name`,
      [req.auth!.school_id, yearId ?? null],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

academicRouter.post(
  '/assessment-categories',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = categorySchema.parse(req.body)
    await assertYearOwned(body.academic_year_id, req.auth!.school_id)
    const { rows } = await pool.query(
      `INSERT INTO assessment_categories (academic_year_id, name, weight_pct, drop_lowest, applies_to_subject_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.academic_year_id, body.name, body.weight_pct, body.drop_lowest ?? 0, body.applies_to_subject_id ?? null],
    )
    res.status(201).json(rows[0])
  }),
)

async function assertYearOwned(academicYearId: string, schoolId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM academic_years WHERE id = $1 AND school_id = $2`, [
    academicYearId,
    schoolId,
  ])
  if (rows.length === 0) throw notFound('Academic year not found')
}
