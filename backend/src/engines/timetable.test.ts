import { describe, expect, it } from 'vitest'
import {
  validateProposedSlot,
  validateTimetableSlots,
} from './timetable.js'
import type { SlotLike, TimetableContext } from './timetable.js'

function ctx(overrides: Partial<TimetableContext> = {}): TimetableContext {
  return {
    periods: new Map([
      ['p1', { isBreak: false, label: 'P1' }],
      ['p2', { isBreak: false, label: 'P2' }],
      ['p3', { isBreak: false, label: 'P3' }],
      ['break', { isBreak: true, label: 'Break' }],
    ]),
    subjects: new Map(),
    staff: new Map(),
    ...overrides,
  }
}

function slot(overrides: Partial<SlotLike> = {}): SlotLike {
  return {
    id: undefined,
    section_id: 'sec-a',
    subject_id: 'math',
    teacher_id: 't1',
    room_id: 'r1',
    weekday: 1,
    period_id: 'p1',
    effective_from: '2026-01-01',
    effective_to: null,
    ...overrides,
  }
}

describe('timetable engine — teacher double-booking', () => {
  it('reports a teacher in two sections at the same slot', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', teacher_id: 't1', section_id: 'sec-b', room_id: 'r2', period_id: 'p1' }),
      [slot({ id: 'old', teacher_id: 't1', section_id: 'sec-a', room_id: 'r1', period_id: 'p1' })],
      ctx(),
    )
    expect(result.valid).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('teacher_double_booked')
  })

  it('allows the same teacher at different periods', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', teacher_id: 't1', section_id: 'sec-b', room_id: 'r1', period_id: 'p2' }),
      [slot({ id: 'old', teacher_id: 't1', section_id: 'sec-a', room_id: 'r1', period_id: 'p1' })],
      ctx(),
    )
    expect(result.valid).toBe(true)
  })
})

describe('timetable engine — room clash', () => {
  it('reports two sections in the same room at the same slot', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', section_id: 'sec-b', subject_id: 'science', teacher_id: 't2', room_id: 'r1', period_id: 'p1' }),
      [slot({ id: 'old', section_id: 'sec-a', subject_id: 'math', teacher_id: 't1', room_id: 'r1', period_id: 'p1' })],
      ctx(),
    )
    expect(result.violations.map((v) => v.code)).toContain('room_clash')
  })

  it('allows the same room at different slots', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', section_id: 'sec-b', room_id: 'r1', period_id: 'p2' }),
      [slot({ id: 'old', section_id: 'sec-a', room_id: 'r1', period_id: 'p1' })],
      ctx(),
    )
    expect(result.valid).toBe(true)
  })
})

describe('timetable engine — section clash', () => {
  it('reports two subjects in one section slot (bulk validate)', () => {
    const result = validateTimetableSlots(
      [
        slot({ id: 'a', section_id: 'sec-a', subject_id: 'math', teacher_id: 't1', room_id: 'r1', period_id: 'p1' }),
        slot({ id: 'b', section_id: 'sec-a', subject_id: 'science', teacher_id: 't2', room_id: 'r2', period_id: 'p1' }),
      ],
      ctx(),
    )
    expect(result.violations.map((v) => v.code)).toContain('section_clash')
  })

  it('reports a section clash for a single proposed slot', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', section_id: 'sec-a', subject_id: 'science', teacher_id: 't2', room_id: 'r2', period_id: 'p1' }),
      [slot({ id: 'old', section_id: 'sec-a', subject_id: 'math', teacher_id: 't1', room_id: 'r1', period_id: 'p1' })],
      ctx(),
    )
    expect(result.violations.map((v) => v.code)).toContain('section_clash')
  })
})

describe('timetable engine — teacher load', () => {
  it('warns when a teacher exceeds max periods per week', () => {
    const slots = [
      slot({ id: 's1', teacher_id: 't1', section_id: 'a', period_id: 'p1' }),
      slot({ id: 's2', teacher_id: 't1', section_id: 'b', period_id: 'p2', room_id: 'r2' }),
      slot({ id: 's3', teacher_id: 't1', section_id: 'c', period_id: 'p3', weekday: 2, room_id: 'r3' }),
    ]
    const result = validateTimetableSlots(slots, ctx({ staff: new Map([['t1', { maxPeriodsPerWeek: 2 }]]) }))
    const load = result.violations.filter((v) => v.code === 'teacher_load')
    expect(load).toHaveLength(1)
    expect(load[0].severity).toBe('warning')
  })

  it('does not warn within max load', () => {
    const result = validateTimetableSlots(
      [slot({ id: 's1', teacher_id: 't1' }), slot({ id: 's2', teacher_id: 't1', period_id: 'p2', room_id: 'r2' })],
      ctx({ staff: new Map([['t1', { maxPeriodsPerWeek: 2 }]]) }),
    )
    expect(result.violations.filter((v) => v.code === 'teacher_load')).toHaveLength(0)
  })
})

describe('timetable engine — subject quota', () => {
  it('warns when a subject is scheduled fewer times than credit hours imply', () => {
    const result = validateTimetableSlots(
      [slot({ id: 's1', subject_id: 'math' }), slot({ id: 's2', subject_id: 'math', period_id: 'p2', room_id: 'r2' })],
      ctx({ subjects: new Map([['math', { creditHours: 5 }]]) }),
    )
    const quota = result.violations.filter((v) => v.code === 'subject_quota')
    expect(quota).toHaveLength(1)
    expect(quota[0].severity).toBe('warning')
  })
})

describe('timetable engine — break violation', () => {
  it('reports a teaching slot on a break period', () => {
    const result = validateProposedSlot(slot({ id: 'new', period_id: 'break' }), [], ctx())
    expect(result.violations.map((v) => v.code)).toContain('break_violation')
    expect(result.valid).toBe(false)
  })
})

describe('timetable engine — free slot', () => {
  it('accepts a slot with no conflicts', () => {
    const result = validateProposedSlot(
      slot({ id: 'new', teacher_id: 't9', room_id: 'r9', section_id: 'sec-z', period_id: 'p3', weekday: 5 }),
      [],
      ctx(),
    )
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('reports every violation, not just the first', () => {
    const existing = slot({ id: 'old', teacher_id: 't1', section_id: 'sec-a', room_id: 'r1', period_id: 'p1' })
    const result = validateProposedSlot(
      slot({ id: 'new', teacher_id: 't1', section_id: 'sec-b', subject_id: 'science', room_id: 'r1', period_id: 'p1' }),
      [existing],
      ctx(),
    )
    const codes = result.violations.map((v) => v.code)
    expect(codes).toContain('teacher_double_booked')
    expect(codes).toContain('room_clash')
  })
})
