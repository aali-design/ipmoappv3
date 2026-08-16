import { describe, expect, it } from 'vitest'
import {
  attendancePercentage,
  effectiveAbsences,
  isExamIneligible,
  totalMarks,
} from './attendance.js'

describe('attendance engine — totals and effective absences', () => {
  it('sums all marks', () => {
    expect(totalMarks({ present: 20, absent: 2, late: 3, excused: 1, sick: 1 })).toBe(27)
  })

  it('converts every N lates into one absence (late-equals-absent)', () => {
    expect(effectiveAbsences(0, 2, 3)).toBe(0)
    expect(effectiveAbsences(0, 3, 3)).toBe(1)
    expect(effectiveAbsences(0, 6, 3)).toBe(2)
    expect(effectiveAbsences(2, 6, 3)).toBe(4)
  })
})

describe('attendance engine — percentage', () => {
  it('returns 100 when there are no effective absences', () => {
    expect(attendancePercentage({ present: 20, absent: 0, late: 2, excused: 0, sick: 0 })).toBe(100)
  })

  it('applies the late-equals-absent rule (default 3)', () => {
    // 3 lates → 1 absence. total 23, effAbsent 1 → 22/23 = 95.65
    expect(attendancePercentage({ present: 20, absent: 0, late: 3, excused: 0, sick: 0 })).toBe(95.65)
  })

  it('treats 6 lates as 2 absences', () => {
    // total 26, effAbsent 2 → 24/26 = 92.31
    expect(attendancePercentage({ present: 20, absent: 0, late: 6, excused: 0, sick: 0 })).toBe(92.31)
  })

  it('counts excused and sick as present, absent against', () => {
    expect(attendancePercentage({ present: 10, absent: 2, late: 0, excused: 3, sick: 0 })).toBe(86.67)
    expect(attendancePercentage({ present: 10, absent: 0, late: 0, excused: 0, sick: 2 })).toBe(100)
  })

  it('respects a custom lateEqualsAbsentCount', () => {
    // lateAsAbsent = floor(2/2) = 1; total 22 → 21/22 = 95.45
    expect(attendancePercentage({ present: 20, absent: 0, late: 2, excused: 0, sick: 0 }, 2)).toBe(95.45)
  })

  it('returns 0 for an empty record set', () => {
    expect(attendancePercentage({ present: 0, absent: 0, late: 0, excused: 0, sick: 0 })).toBe(0)
  })
})

describe('attendance engine — eligibility', () => {
  it('flags below-threshold students as exam-ineligible', () => {
    expect(isExamIneligible(74.99, 75)).toBe(true)
    expect(isExamIneligible(75, 75)).toBe(false)
    expect(isExamIneligible(40, 60)).toBe(true)
  })
})
