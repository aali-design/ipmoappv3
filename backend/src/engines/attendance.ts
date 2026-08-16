import { roundHalfUp } from '../lib/rounding.js'

/**
 * ATTENDANCE ENGINE (spec §5).
 *
 * Late-equals-absent rule: every `lateEqualsAbsentCount` "late" marks count as
 * one additional absence in the percentage calculation. For example, with the
 * default threshold of 3: 0-2 lates -> 0 absences, 3-5 lates -> 1 absence,
 * 6-8 -> 2 absences. Percentage = (total - effectiveAbsences) / total × 100,
 * where excused and sick marks count as present.
 */

export const DEFAULT_LATE_EQUALS_ABSENT = 3
export const DEFAULT_MIN_ATTENDANCE_PCT = 75

export interface AttendanceCounts {
  present: number
  absent: number
  late: number
  excused: number
  sick: number
}

export function totalMarks(c: AttendanceCounts): number {
  return c.present + c.absent + c.late + c.excused + c.sick
}

export function effectiveAbsences(
  absent: number,
  late: number,
  lateEqualsAbsentCount: number,
): number {
  const threshold = Math.max(1, lateEqualsAbsentCount)
  return absent + Math.floor(late / threshold)
}

export function attendancePercentage(
  c: AttendanceCounts,
  lateEqualsAbsentCount: number = DEFAULT_LATE_EQUALS_ABSENT,
): number {
  const total = totalMarks(c)
  if (total === 0) return 0
  const effAbsent = effectiveAbsences(c.absent, c.late, lateEqualsAbsentCount)
  return roundHalfUp(((total - effAbsent) / total) * 100, 2)
}

/** Exam-eligibility flag for report cards and the warnings queue (spec §5). */
export function isExamIneligible(pct: number, minAttendancePct: number): boolean {
  return pct < minAttendancePct
}
