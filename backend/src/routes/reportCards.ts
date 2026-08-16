import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { invalidTransition, notFound, badRequest } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'
import { buildSectionReportCards } from '../services/reportCards.js'
import { dispatchWebhook } from '../engines/webhooks.js'

export const reportCardsRouter = Router()

const generateSchema = z.object({ termId: z.string().uuid(), sectionId: z.string().uuid() })

reportCardsRouter.post(
  '/report-cards/generate',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = generateSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const sectionRes = await pool.query(
      `SELECT 1 FROM sections sec JOIN academic_years ay ON ay.id = sec.academic_year_id
        WHERE sec.id = $1 AND ay.school_id = $2`,
      [body.sectionId, schoolId],
    )
    if (sectionRes.rowCount === 0) throw notFound('Section not found')

    const built = await buildSectionReportCards(schoolId, body.termId, body.sectionId)

    let created = 0
    let skipped = 0
    for (const rc of built) {
      const existing = await pool.query(
        `SELECT 1 FROM report_cards WHERE student_id = $1 AND term_id = $2`,
        [rc.studentId, body.termId],
      )
      if ((existing.rowCount ?? 0) > 0) {
        skipped++
        continue
      }
      await pool.query(
        `INSERT INTO report_cards
          (student_id, term_id, enrollment_id, status, snapshot_json, snapshot_hash,
           overall_percentage, gpa, class_rank, class_size, attendance_pct, version)
         VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,1)`,
        [
          rc.studentId,
          body.termId,
          rc.enrollmentId,
          JSON.stringify(rc.snapshot),
          rc.snapshotHash,
          rc.overallPercentage,
          rc.gpa,
          rc.classRank,
          rc.classSize,
          rc.attendancePct,
        ],
      )
      created++
    }

    res.status(201).json({ created, skipped })
  }),
)

async function getCardForUpdate(cardId: string, schoolId: string): Promise<Record<string, unknown>> {
  const res = await pool.query(
    `SELECT rc.*, sec.id AS section_id, sec.academic_year_id
       FROM report_cards rc
       JOIN enrollments e ON e.id = rc.enrollment_id
       JOIN sections sec ON sec.id = e.section_id
       JOIN academic_years ay ON ay.id = sec.academic_year_id
      WHERE rc.id = $1 AND ay.school_id = $2`,
    [cardId, schoolId],
  )
  if (res.rowCount === 0) throw notFound('Report card not found')
  return res.rows[0]
}

reportCardsRouter.get(
  '/report-cards/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const card = await getCardForUpdate(req.params.id, req.auth!.school_id)
    const studentId = card.student_id as string
    const auth = req.auth!
    if (auth.role === 'guardian' && !auth.student_ids?.includes(studentId)) throw notFound('Report card not found')
    if (auth.role === 'student' && auth.student_id !== studentId) throw notFound('Report card not found')

    res.json(card)
  }),
)

reportCardsRouter.post(
  '/report-cards/:id/submit',
  authenticate,
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const card = await getCardForUpdate(req.params.id, req.auth!.school_id)
    if (card.status === 'published') throw invalidTransition('published', 'submitted', ['draft'])
    await pool.query(`UPDATE report_cards SET status = 'submitted' WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  }),
)

reportCardsRouter.post(
  '/report-cards/:id/publish',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const schoolId = req.auth!.school_id
    const card = await getCardForUpdate(req.params.id, schoolId)
    if (card.status === 'published') throw invalidTransition('published', 'published', ['draft', 'submitted'])

    const termId = card.term_id as string
    const sectionId = card.section_id as string
    const studentId = card.student_id as string
    const built = await buildSectionReportCards(schoolId, termId, sectionId)
    const mine = built.find((b) => b.studentId === studentId)
    if (!mine) throw badRequest('Cannot publish: no computed report card for this student')

    await pool.query(
      `UPDATE report_cards
         SET status = 'published', snapshot_json = $1, snapshot_hash = $2,
             overall_percentage = $3, gpa = $4, class_rank = $5, class_size = $6,
             attendance_pct = $7, published_at = now(), published_by = $8
       WHERE id = $9`,
      [
        JSON.stringify(mine.snapshot),
        mine.snapshotHash,
        mine.overallPercentage,
        mine.gpa,
        mine.classRank,
        mine.classSize,
        mine.attendancePct,
        req.auth!.id,
        req.params.id,
      ],
    )

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'report_card.publish',
      entityType: 'report_card',
      entityId: req.params.id,
    })
    dispatchWebhook('report_card.published', schoolId, { report_card_id: req.params.id, student_id: studentId, term_id: termId })

    const updated = await pool.query(`SELECT * FROM report_cards WHERE id = $1`, [req.params.id])
    res.json(updated.rows[0])
  }),
)

const reviseSchema = z.object({ reason: z.string().min(1) })

reportCardsRouter.post(
  '/report-cards/:id/revise',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = reviseSchema.parse(req.body)
    const schoolId = req.auth!.school_id
    const card = await getCardForUpdate(req.params.id, schoolId)
    if (card.status !== 'published') throw invalidTransition(card.status as string, 'draft', ['published'])

    const termId = card.term_id as string
    const sectionId = card.section_id as string
    const studentId = card.student_id as string
    const built = await buildSectionReportCards(schoolId, termId, sectionId)
    const mine = built.find((b) => b.studentId === studentId)
    if (!mine) throw badRequest('Cannot revise: no computed report card for this student')

    const nextVersion = (card.version as number) + 1

    const { rows } = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO report_cards
          (student_id, term_id, enrollment_id, status, snapshot_json, snapshot_hash,
           overall_percentage, gpa, class_rank, class_size, attendance_pct, version)
         VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          studentId,
          termId,
          card.enrollment_id,
          JSON.stringify(mine.snapshot),
          mine.snapshotHash,
          mine.overallPercentage,
          mine.gpa,
          mine.classRank,
          mine.classSize,
          mine.attendancePct,
          nextVersion,
        ],
      )
      return inserted
    })

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'report_card.revise',
      entityType: 'report_card',
      entityId: req.params.id,
      metadata: { reason: body.reason, newVersion: nextVersion },
    })

    res.status(201).json(rows[0])
  }),
)

reportCardsRouter.get(
  '/students/:id/report-cards',
  authenticate,
  asyncHandler(async (req, res) => {
    const studentId = req.params.id
    const auth = req.auth!
    if (auth.role === 'guardian' && !auth.student_ids?.includes(studentId)) throw notFound('Report cards not found')
    if (auth.role === 'student' && auth.student_id !== studentId) throw notFound('Report cards not found')

    const { rows } = await pool.query(
      `SELECT rc.*, t.name AS term_name FROM report_cards rc JOIN terms t ON t.id = rc.term_id
        WHERE rc.student_id = $1 ORDER BY rc.term_id, rc.version`,
      [studentId],
    )
    res.json({ items: rows, total: rows.length })
  }),
)
