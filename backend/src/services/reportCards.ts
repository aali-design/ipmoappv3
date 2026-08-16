import { pool } from '../db/pool.js'
import { canonicalJson, sha256Hex } from '../lib/crypto.js'
import { computeSectionGrades, loadAttendanceCounts } from './grading.js'
import { attendancePercentage } from '../engines/attendance.js'
import type { GradesResponse } from '../engines/grading.js'

export interface ReportCardSnapshot {
  generated_at: string
  term_id: string
  grading_scale: { id: string | null; name: string | null; bands: unknown }
  subjects: GradesResponse['subjects']
  overall_percentage: number | null
  overall_gpa: number | null
  letter: string | null
  class_rank: number | null
  class_size: number | null
  attendance: {
    present: number
    absent: number
    late: number
    excused: number
    sick: number
    percentage: number
  }
  exam_ineligible: boolean
}

export interface BuiltReportCard {
  studentId: string
  enrollmentId: string
  snapshot: ReportCardSnapshot
  snapshotHash: string
  overallPercentage: number | null
  gpa: number | null
  classRank: number | null
  classSize: number | null
  attendancePct: number
}

export async function getSchoolAttendancePolicy(schoolId: string): Promise<{
  lateEqualsAbsent: number
  minAttendancePct: number
}> {
  const res = await pool.query(`SELECT settings_json FROM schools WHERE id = $1`, [schoolId])
  const settings = (res.rows[0]?.settings_json ?? {}) as {
    lateEqualsAbsentCount?: number
    minAttendancePct?: number
  }
  return {
    lateEqualsAbsent: settings.lateEqualsAbsentCount ?? 3,
    minAttendancePct: settings.minAttendancePct ?? 75,
  }
}

export async function buildSectionReportCards(
  schoolId: string,
  termId: string,
  sectionId: string,
): Promise<BuiltReportCard[]> {
  const { byStudent } = await computeSectionGrades(schoolId, sectionId, termId)
  const policy = await getSchoolAttendancePolicy(schoolId)

  const scaleRes = await pool.query(
    `SELECT id, name, bands_json FROM grading_scales WHERE school_id = $1 AND is_default = true LIMIT 1`,
    [schoolId],
  )
  const scale = scaleRes.rows[0]

  const enrollmentRes = await pool.query(
    `SELECT id, student_id FROM enrollments
      WHERE section_id = $1 AND left_on IS NULL
        AND academic_year_id = (SELECT academic_year_id FROM terms WHERE id = $2)`,
    [sectionId, termId],
  )
  const enrollmentByStudent = new Map(
    enrollmentRes.rows.map((r) => [r.student_id as string, r.id as string]),
  )

  const built: BuiltReportCard[] = []
  for (const [studentId, grades] of byStudent) {
    const counts = await loadAttendanceCounts(studentId, termId)
    const pct = attendancePercentage(counts, policy.lateEqualsAbsent)
    const enrollmentId = enrollmentByStudent.get(studentId)
    if (!enrollmentId) continue

    const snapshot: ReportCardSnapshot = {
      generated_at: new Date().toISOString(),
      term_id: termId,
      grading_scale: {
        id: (scale?.id as string) ?? null,
        name: (scale?.name as string) ?? null,
        bands: scale?.bands_json ?? [],
      },
      subjects: grades.subjects,
      overall_percentage: grades.overall_percentage,
      overall_gpa: grades.overall_gpa,
      letter: grades.letter,
      class_rank: grades.class_rank,
      class_size: grades.class_size,
      attendance: {
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,
        sick: counts.sick,
        percentage: pct,
      },
      exam_ineligible: pct < policy.minAttendancePct,
    }

    built.push({
      studentId,
      enrollmentId,
      snapshot,
      snapshotHash: sha256Hex(canonicalJson(snapshot)),
      overallPercentage: grades.overall_percentage,
      gpa: grades.overall_gpa,
      classRank: grades.class_rank,
      classSize: grades.class_size,
      attendancePct: pct,
    })
  }

  return built
}
