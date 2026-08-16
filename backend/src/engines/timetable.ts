/**
 * TIMETABLE ENGINE (spec §4) — constraint checker returning every violation.
 */

export interface SlotLike {
  id?: string
  section_id: string
  subject_id: string
  teacher_id: string
  room_id: string | null
  weekday: number // 1..7
  period_id: string
  effective_from: string // ISO date
  effective_to: string | null
}

export interface TimetableContext {
  periods: Map<string, { isBreak: boolean; label?: string }>
  subjects: Map<string, { creditHours: number; name?: string; code?: string }>
  staff: Map<string, { maxPeriodsPerWeek?: number | null }>
}

export type ConflictSeverity = 'error' | 'warning'

export interface TimetableViolation {
  code: string
  severity: ConflictSeverity
  weekday: number
  periodId: string
  entities: Record<string, unknown>
  message: string
}

export interface TimetableValidationResult {
  valid: boolean
  violations: TimetableViolation[]
}

function overlaps(a: SlotLike, b: SlotLike): boolean {
  const aFrom = new Date(a.effective_from).getTime()
  const aTo = a.effective_to ? new Date(a.effective_to).getTime() : Number.POSITIVE_INFINITY
  const bFrom = new Date(b.effective_from).getTime()
  const bTo = b.effective_to ? new Date(b.effective_to).getTime() : Number.POSITIVE_INFINITY
  return aFrom <= bTo && bFrom <= aTo
}

function sameSlot(a: SlotLike, b: SlotLike): boolean {
  return a.weekday === b.weekday && a.period_id === b.period_id
}

/** Pairwise hard-constraint violations (teacher/room/section clash, break). */
export function pairwiseViolations(slots: SlotLike[], ctx: TimetableContext): TimetableViolation[] {
  const violations: TimetableViolation[] = []
  const n = slots.length

  for (let i = 0; i < n; i++) {
    const s = slots[i]
    const period = ctx.periods.get(s.period_id)
    if (period?.isBreak) {
      violations.push({
        code: 'break_violation',
        severity: 'error',
        weekday: s.weekday,
        periodId: s.period_id,
        entities: { sectionId: s.section_id, subjectId: s.subject_id, periodId: s.period_id },
        message: `Period ${period.label ?? s.period_id} is a break and cannot hold a lesson`,
      })
    }

    for (let j = i + 1; j < n; j++) {
      const t = slots[j]
      if (!sameSlot(s, t) || !overlaps(s, t)) continue

      if (s.teacher_id === t.teacher_id && s.section_id !== t.section_id) {
        violations.push({
          code: 'teacher_double_booked',
          severity: 'error',
          weekday: s.weekday,
          periodId: s.period_id,
          entities: {
            teacherId: s.teacher_id,
            sectionA: s.section_id,
            sectionB: t.section_id,
            subjectA: s.subject_id,
            subjectB: t.subject_id,
          },
          message: `Teacher is already booked in another section at this slot`,
        })
      }

      if (s.room_id && t.room_id && s.room_id === t.room_id) {
        violations.push({
          code: 'room_clash',
          severity: 'error',
          weekday: s.weekday,
          periodId: s.period_id,
          entities: { roomId: s.room_id, sectionA: s.section_id, sectionB: t.section_id },
          message: `Room is already occupied at this slot`,
        })
      }

      if (s.section_id === t.section_id && s.subject_id !== t.subject_id) {
        violations.push({
          code: 'section_clash',
          severity: 'error',
          weekday: s.weekday,
          periodId: s.period_id,
          entities: {
            sectionId: s.section_id,
            subjectA: s.subject_id,
            subjectB: t.subject_id,
          },
          message: `Section already has another subject at this slot`,
        })
      }
    }
  }

  return violations
}

/** Teacher-load warnings (periods/week over the configured maximum). */
export function teacherLoadViolations(slots: SlotLike[], ctx: TimetableContext): TimetableViolation[] {
  const violations: TimetableViolation[] = []
  const byTeacher = new Map<string, SlotLike[]>()
  for (const s of slots) {
    const arr = byTeacher.get(s.teacher_id) ?? []
    arr.push(s)
    byTeacher.set(s.teacher_id, arr)
  }

  for (const [teacherId, list] of byTeacher) {
    const max = ctx.staff.get(teacherId)?.maxPeriodsPerWeek
    if (max == null || max <= 0) continue
    if (list.length > max) {
      violations.push({
        code: 'teacher_load',
        severity: 'warning',
        weekday: list[0].weekday,
        periodId: list[0].period_id,
        entities: { teacherId, periodsPerWeek: list.length, maxPeriodsPerWeek: max },
        message: `Teacher has ${list.length} periods/week, exceeding the maximum of ${max}`,
      })
    }
  }

  return violations
}

/** Subject-quota warnings: a subject scheduled fewer times than credit hours imply. */
export function subjectQuotaViolations(slots: SlotLike[], ctx: TimetableContext): TimetableViolation[] {
  const violations: TimetableViolation[] = []
  const bySectionSubject = new Map<string, SlotLike[]>()
  for (const s of slots) {
    const key = `${s.section_id}:${s.subject_id}`
    const arr = bySectionSubject.get(key) ?? []
    arr.push(s)
    bySectionSubject.set(key, arr)
  }

  for (const [key, list] of bySectionSubject) {
    const sectionId = key.split(':')[0]
    const subjectId = key.split(':')[1]
    const subject = ctx.subjects.get(subjectId)
    if (!subject) continue
    const required = Math.ceil(subject.creditHours)
    if (required > 0 && list.length < required) {
      violations.push({
        code: 'subject_quota',
        severity: 'warning',
        weekday: list[0].weekday,
        periodId: list[0].period_id,
        entities: { sectionId, subjectId, scheduled: list.length, required },
        message: `Subject scheduled ${list.length} times/week, fewer than the ${required} implied by its credit hours`,
      })
    }
  }

  return violations
}

/** Full validation of a slot set against itself. */
export function validateTimetableSlots(slots: SlotLike[], ctx: TimetableContext): TimetableValidationResult {
  const violations = [
    ...pairwiseViolations(slots, ctx),
    ...teacherLoadViolations(slots, ctx),
    ...subjectQuotaViolations(slots, ctx),
  ]
  return {
    valid: !violations.some((v) => v.severity === 'error'),
    violations,
  }
}

/**
 * Validate a single proposed slot against the existing timetable. Only
 * violations involving the proposed slot (or its teacher/section aggregate)
 * are reported, so pre-existing conflicts elsewhere do not block a new insert.
 */
export function validateProposedSlot(
  proposed: SlotLike,
  existing: SlotLike[],
  ctx: TimetableContext,
): TimetableValidationResult {
  const combined = [...existing, proposed]

  const pairwise = pairwiseViolations(combined, ctx).filter((v) => {
    const e = v.entities
    return (
      (e.sectionA === proposed.section_id || e.sectionB === proposed.section_id) ||
      e.sectionId === proposed.section_id ||
      (e.teacherId === proposed.teacher_id) ||
      (e.roomId === proposed.room_id && proposed.room_id != null)
    )
  })

  const breakV = pairwiseViolations([proposed], ctx)

  const load = teacherLoadViolations(combined, ctx).filter(
    (v) => v.entities.teacherId === proposed.teacher_id,
  )

  const violations = [...pairwise, ...breakV, ...load]

  return {
    valid: !violations.some((v) => v.severity === 'error'),
    violations,
  }
}
