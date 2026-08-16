import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { notFound, unprocessable } from '../lib/errors.js'
import {
  validateProposedSlot,
  validateTimetableSlots,
  type SlotLike,
  type TimetableContext,
  type TimetableViolation,
} from '../engines/timetable.js'

export const timetableRouter = Router()

async function loadContext(schoolId: string, academicYearId: string): Promise<TimetableContext> {
  const periods = await pool.query(
    `SELECT id, is_break, label FROM periods WHERE academic_year_id = $1`,
    [academicYearId],
  )
  const subjects = await pool.query(`SELECT id, credit_hours, name, code FROM subjects WHERE school_id = $1`, [
    schoolId,
  ])
  const staff = await pool.query(`SELECT id FROM staff WHERE school_id = $1`, [schoolId])
  const schoolRes = await pool.query(`SELECT settings_json FROM schools WHERE id = $1`, [schoolId])
  const settings = (schoolRes.rows[0]?.settings_json ?? {}) as { maxPeriodsPerWeek?: number }
  const maxPeriodsPerWeek = settings.maxPeriodsPerWeek ?? null

  return {
    periods: new Map(periods.rows.map((p) => [p.id as string, { isBreak: p.is_break as boolean, label: p.label as string }])),
    subjects: new Map(subjects.rows.map((s) => [s.id as string, { creditHours: Number(s.credit_hours), name: s.name as string, code: s.code as string }])),
    staff: new Map(staff.rows.map((s) => [s.id as string, { maxPeriodsPerWeek }])),
  }
}

async function loadSlots(schoolId: string, academicYearId: string, filter?: { sectionId?: string; teacherId?: string; roomId?: string }): Promise<SlotLike[]> {
  let where = `ts.academic_year_id = $1 AND ay.school_id = $2`
  const params: unknown[] = [academicYearId, schoolId]
  if (filter?.sectionId) {
    params.push(filter.sectionId)
    where += ` AND ts.section_id = $${params.length}`
  }
  if (filter?.teacherId) {
    params.push(filter.teacherId)
    where += ` AND ts.teacher_id = $${params.length}`
  }
  if (filter?.roomId) {
    params.push(filter.roomId)
    where += ` AND ts.room_id = $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT ts.id, ts.section_id, ts.subject_id, ts.teacher_id, ts.room_id,
            ts.weekday, ts.period_id, ts.effective_from, ts.effective_to
       FROM timetable_slots ts
       JOIN academic_years ay ON ay.id = ts.academic_year_id
      WHERE ${where}
      ORDER BY ts.weekday, ts.period_id`,
    params,
  )
  return rows.map((r) => ({
    id: r.id as string,
    section_id: r.section_id as string,
    subject_id: r.subject_id as string,
    teacher_id: r.teacher_id as string,
    room_id: (r.room_id as string) ?? null,
    weekday: Number(r.weekday),
    period_id: r.period_id as string,
    effective_from: r.effective_from as string,
    effective_to: (r.effective_to as string) ?? null,
  }))
}

function attachConflicts(slots: SlotLike[], violations: TimetableViolation[]): Map<string, TimetableViolation[]> {
  const map = new Map<string, TimetableViolation[]>()
  for (const v of violations) {
    const involved = new Set<string>()
    for (const s of slots) {
      const e = v.entities
      const match =
        (e.sectionA === s.section_id || e.sectionB === s.section_id || e.sectionId === s.section_id) ||
        e.teacherId === s.teacher_id ||
        (e.roomId != null && e.roomId === s.room_id)
      if (match && s.weekday === v.weekday && s.period_id === v.periodId) involved.add(s.id ?? s.section_id)
    }
    for (const id of involved) {
      const arr = map.get(id) ?? []
      arr.push(v)
      map.set(id, arr)
    }
  }
  return map
}

timetableRouter.get(
  '/timetable',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian'),
  asyncHandler(async (req, res) => {
    const sectionId = req.query.sectionId as string | undefined
    const teacherId = req.query.teacherId as string | undefined
    const roomId = req.query.roomId as string | undefined
    const academicYearId = req.query.academicYearId as string | undefined

    let yearId = academicYearId
    if (!yearId) {
      const yr = await pool.query(
        `SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1`,
        [req.auth!.school_id],
      )
      if (yr.rowCount === 0) return res.json({ academic_year_id: null, weekdays: {} })
      yearId = yr.rows[0].id as string
    }

    const slots = await loadSlots(req.auth!.school_id, yearId, { sectionId, teacherId, roomId })
    const ctx = await loadContext(req.auth!.school_id, yearId)
    const violations = validateTimetableSlots(slots, ctx).violations
    const conflicts = attachConflicts(slots, violations)

    const weekdays: Record<number, { slot: unknown; conflicts: TimetableViolation[] }[]> = {}
    for (let d = 1; d <= 7; d++) weekdays[d] = []

    const slotsById = await pool.query(
      `SELECT ts.id, s.name AS subject_name, sub.code AS subject_code,
              st.full_name AS teacher_name, r.name AS room_name, p.label AS period_label,
              p.starts_at, p.ends_at
         FROM timetable_slots ts
         JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN staff st ON st.id = ts.teacher_id
         LEFT JOIN rooms r ON r.id = ts.room_id
         LEFT JOIN periods p ON p.id = ts.period_id
        WHERE ts.academic_year_id = $1`,
      [yearId],
    )
    const enrichById = new Map(slotsById.rows.map((r) => [r.id as string, r]))

    for (const slot of slots) {
      const id = slot.id ?? slot.section_id
      const enrich = enrichById.get(slot.id ?? '')
      weekdays[slot.weekday].push({
        slot: { ...slot, ...(enrich ? { subject_name: enrich.subject_name, teacher_name: enrich.teacher_name, room_name: enrich.room_name, period_label: enrich.period_label } : {}) },
        conflicts: conflicts.get(id) ?? [],
      })
    }

    res.json({ academic_year_id: yearId, weekdays })
  }),
)

const slotCreateSchema = z.object({
  academic_year_id: z.string().uuid(),
  section_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  room_id: z.string().uuid().nullable().optional(),
  weekday: z.number().int().min(1).max(7),
  period_id: z.string().uuid(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

timetableRouter.post(
  '/timetable/slots',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = slotCreateSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const proposed: SlotLike = {
      section_id: body.section_id,
      subject_id: body.subject_id,
      teacher_id: body.teacher_id,
      room_id: body.room_id ?? null,
      weekday: body.weekday,
      period_id: body.period_id,
      effective_from: body.effective_from,
      effective_to: body.effective_to ?? null,
    }

    const ctx = await loadContext(schoolId, body.academic_year_id)
    const existing = await loadSlots(schoolId, body.academic_year_id)
    const result = validateProposedSlot(proposed, existing, ctx)

    if (!result.valid) {
      throw unprocessable('TimetableConflict', 'The slot conflicts with the timetable', {
        violations: result.violations,
      })
    }

    const { rows } = await pool.query(
      `INSERT INTO timetable_slots
        (academic_year_id, section_id, subject_id, teacher_id, room_id, weekday, period_id, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        body.academic_year_id,
        body.section_id,
        body.subject_id,
        body.teacher_id,
        body.room_id ?? null,
        body.weekday,
        body.period_id,
        body.effective_from,
        body.effective_to ?? null,
      ],
    )
    res.status(201).json({ ...rows[0], violations: result.violations })
  }),
)

const validateSchema = z.object({
  academic_year_id: z.string().uuid(),
  slots: z.array(
    z.object({
      section_id: z.string().uuid(),
      subject_id: z.string().uuid(),
      teacher_id: z.string().uuid(),
      room_id: z.string().uuid().nullable().optional(),
      weekday: z.number().int().min(1).max(7),
      period_id: z.string().uuid(),
      effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }),
  ),
})

timetableRouter.post(
  '/timetable/validate',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const body = validateSchema.parse(req.body)
    const ctx = await loadContext(req.auth!.school_id, body.academic_year_id)
    const existing = await loadSlots(req.auth!.school_id, body.academic_year_id)
    const proposed: SlotLike[] = body.slots.map((s) => ({
      section_id: s.section_id,
      subject_id: s.subject_id,
      teacher_id: s.teacher_id,
      room_id: s.room_id ?? null,
      weekday: s.weekday,
      period_id: s.period_id,
      effective_from: s.effective_from,
      effective_to: s.effective_to ?? null,
    }))
    const result = validateTimetableSlots([...existing, ...proposed], ctx)
    res.json(result)
  }),
)

timetableRouter.get(
  '/timetable/suggest',
  authenticate,
  requireRole('admin', 'registrar'),
  asyncHandler(async (req, res) => {
    const sectionId = req.query.sectionId as string
    const subjectId = req.query.subjectId as string
    const teacherId = req.query.teacherId as string
    const academicYearId = req.query.academicYearId as string
    if (!sectionId || !subjectId || !teacherId || !academicYearId) throw notFound('Missing query params')

    const ctx = await loadContext(req.auth!.school_id, academicYearId)
    const existing = await loadSlots(req.auth!.school_id, academicYearId)

    const suggestions: { weekday: number; periodId: string; period?: unknown }[] = []
    const periodIds = [...ctx.periods.keys()]
    const periodLabels = await pool.query(`SELECT id, label, starts_at, ends_at FROM periods WHERE academic_year_id = $1`, [academicYearId])
    const periodById = new Map(periodLabels.rows.map((p) => [p.id as string, p]))

    for (let weekday = 1; weekday <= 7; weekday++) {
      for (const periodId of periodIds) {
        const period = ctx.periods.get(periodId)
        if (period?.isBreak) continue
        const proposed: SlotLike = {
          section_id: sectionId,
          subject_id: subjectId,
          teacher_id: teacherId,
          room_id: null,
          weekday,
          period_id: periodId,
          effective_from: new Date().toISOString().slice(0, 10),
          effective_to: null,
        }
        const result = validateProposedSlot(proposed, existing, ctx)
        if (result.valid) {
          suggestions.push({ weekday, periodId, period: periodById.get(periodId) ?? null })
        }
      }
    }
    res.json({ items: suggestions })
  }),
)

timetableRouter.get(
  '/teachers/:id/timetable',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ts.id, ts.section_id, ts.subject_id, ts.teacher_id, ts.room_id, ts.weekday, ts.period_id, ts.effective_from, ts.effective_to,
              sub.name AS subject_name, sub.code AS subject_code, sec.name AS section_name, r.name AS room_name, p.label AS period_label, p.starts_at, p.ends_at
         FROM timetable_slots ts
         JOIN subjects sub ON sub.id = ts.subject_id
         JOIN sections sec ON sec.id = ts.section_id
         LEFT JOIN rooms r ON r.id = ts.room_id
         LEFT JOIN periods p ON p.id = ts.period_id
        WHERE ts.teacher_id = $1
        ORDER BY ts.weekday, p.sequence`,
      [req.params.id],
    )
    res.json({ items: rows })
  }),
)

timetableRouter.get(
  '/students/:id/timetable',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ts.id, ts.section_id, ts.subject_id, ts.teacher_id, ts.room_id, ts.weekday, ts.period_id, ts.effective_from, ts.effective_to,
              sub.name AS subject_name, sub.code AS subject_code, st.full_name AS teacher_name, r.name AS room_name, p.label AS period_label, p.starts_at, p.ends_at
         FROM enrollments e
         JOIN timetable_slots ts ON ts.section_id = e.section_id
         JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN staff st ON st.id = ts.teacher_id
         LEFT JOIN rooms r ON r.id = ts.room_id
         LEFT JOIN periods p ON p.id = ts.period_id
        WHERE e.student_id = $1 AND e.left_on IS NULL
        ORDER BY ts.weekday, p.sequence`,
      [req.params.id],
    )
    res.json({ items: rows })
  }),
)
