import { pool } from '../db/pool.js'
import {
  computeOverall,
  computeSubjectGrade,
  denseRank,
  type AssessmentInput,
  type BandInput,
  type CategoryInput,
  type GradesResponse,
  type SubjectGrade,
} from '../engines/grading.js'
import { attendancePercentage, type AttendanceCounts } from '../engines/attendance.js'

export interface GradingContext {
  subjects: { id: string; name: string; code: string; creditHours: number }[]
  categories: CategoryInput[]
  assessments: AssessmentInput[]
  bands: BandInput[]
}

interface EnrolledStudent {
  student_id: string
  first_name: string
  last_name: string
  admission_no: string
  roll_no: number | null
}

export async function loadGradingContext(
  schoolId: string,
  sectionId: string,
  termId: string,
): Promise<GradingContext> {
  const subjectsRes = await pool.query(
    `SELECT s.id, s.name, s.code, s.credit_hours
       FROM teaching_assignments ta
       JOIN subjects s ON s.id = ta.subject_id
      WHERE ta.section_id = $1
      ORDER BY s.name`,
    [sectionId],
  )

  const categoriesRes = await pool.query(
    `SELECT id, name, weight_pct, drop_lowest
       FROM assessment_categories
      WHERE academic_year_id = (SELECT academic_year_id FROM terms WHERE id = $1)`,
    [termId],
  )

  const assessmentsRes = await pool.query(
    `SELECT a.id, a.title, a.category_id, a.max_score, a.weight_override_pct, a.subject_id
       FROM assessments a
      WHERE a.term_id = $1 AND a.section_id = $2
      ORDER BY a.title`,
    [termId, sectionId],
  )

  const scaleRes = await pool.query(
    `SELECT bands_json FROM grading_scales WHERE school_id = $1 AND is_default = true LIMIT 1`,
    [schoolId],
  )
  const bands: BandInput[] = scaleRes.rows[0]?.bands_json ?? []

  return {
    subjects: subjectsRes.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      code: r.code as string,
      creditHours: Number(r.credit_hours),
    })),
    categories: categoriesRes.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      weight_pct: Number(r.weight_pct),
      drop_lowest: Number(r.drop_lowest),
    })),
    assessments: assessmentsRes.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      category_id: r.category_id as string,
      max_score: Number(r.max_score),
      weight_override_pct: r.weight_override_pct == null ? null : Number(r.weight_override_pct),
      subject_id: r.subject_id as string,
    })) as (AssessmentInput & { subject_id: string })[],
    bands,
  }
}

export async function enrolledStudents(sectionId: string, termId: string): Promise<EnrolledStudent[]> {
  const res = await pool.query(
    `SELECT e.student_id, s.first_name, s.last_name, s.admission_no, e.roll_no
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
      WHERE e.section_id = $1
        AND e.academic_year_id = (SELECT academic_year_id FROM terms WHERE id = $2)
        AND e.left_on IS NULL
      ORDER BY e.roll_no NULLS LAST, s.last_name`,
    [sectionId, termId],
  )
  return res.rows.map((r) => ({
    student_id: r.student_id as string,
    first_name: r.first_name as string,
    last_name: r.last_name as string,
    admission_no: r.admission_no as string,
    roll_no: r.roll_no == null ? null : Number(r.roll_no),
  }))
}

export async function loadAttendanceCounts(
  studentId: string,
  termId: string,
): Promise<AttendanceCounts> {
  const res = await pool.query(
    `SELECT
       count(*) FILTER (WHERE ar.status = 'present') AS present,
       count(*) FILTER (WHERE ar.status = 'absent')  AS absent,
       count(*) FILTER (WHERE ar.status = 'late')    AS late,
       count(*) FILTER (WHERE ar.status = 'excused') AS excused,
       count(*) FILTER (WHERE ar.status = 'sick')    AS sick
     FROM attendance_records ar
     JOIN attendance_sessions asess ON asess.id = ar.session_id
     JOIN terms t ON t.id = $2
    WHERE ar.student_id = $1
      AND asess.date BETWEEN t.starts_on AND t.ends_on`,
    [studentId, termId],
  )
  const r = res.rows[0]
  const toNum = (v: unknown) => (v == null ? 0 : Number(v))
  return {
    present: toNum(r?.present),
    absent: toNum(r?.absent),
    late: toNum(r?.late),
    excused: toNum(r?.excused),
    sick: toNum(r?.sick),
  }
}

/**
 * Compute grades for every enrolled student in a section/term, including
 * class rank (dense rank over overall percentage). Returns grades keyed by
 * student id plus the shared context.
 */
export async function computeSectionGrades(
  schoolId: string,
  sectionId: string,
  termId: string,
): Promise<{ byStudent: Map<string, GradesResponse>; context: GradingContext }> {
  const context = await loadGradingContext(schoolId, sectionId, termId)
  const students = await enrolledStudents(sectionId, termId)
  const assessmentIds = context.assessments.map((a) => a.id)

  let marksByStudent = new Map<string, Record<string, { score: number | null; is_absent: boolean; is_excused: boolean }>>()
  if (assessmentIds.length > 0) {
    const marksRes = await pool.query(
      `SELECT assessment_id, student_id, score, is_absent, is_excused
         FROM marks WHERE assessment_id = ANY($1)`,
      [assessmentIds],
    )
    for (const m of marksRes.rows) {
      let map = marksByStudent.get(m.student_id as string)
      if (!map) {
        map = {}
        marksByStudent.set(m.student_id as string, map)
      }
      map[m.assessment_id as string] = {
        score: m.score == null ? null : Number(m.score),
        is_absent: m.is_absent as boolean,
        is_excused: m.is_excused as boolean,
      }
    }
  }

  const subjectGradesByStudent = new Map<string, SubjectGrade[]>()
  const overalls: { studentId: string; overall: number | null }[] = []

  for (const student of students) {
    const marks = marksByStudent.get(student.student_id) ?? {}
    const subjectGrades: SubjectGrade[] = context.subjects.map((subj) => {
      const assessments = context.assessments.filter((a) => a.subject_id === subj.id)
      const marksForSubject: Record<string, { score: number | null; is_absent: boolean; is_excused: boolean }> = {}
      for (const a of assessments) {
        if (marks[a.id]) marksForSubject[a.id] = marks[a.id]
      }
      return computeSubjectGrade({
        subjectId: subj.id,
        subjectName: subj.name,
        subjectCode: subj.code,
        creditHours: subj.creditHours,
        categories: context.categories,
        assessments: assessments.map(({ subject_id: _s, ...rest }) => rest),
        marks: marksForSubject,
        bands: context.bands,
      })
    })
    const overall = computeOverall(subjectGrades, context.bands)
    subjectGradesByStudent.set(student.student_id, subjectGrades)
    overalls.push({ studentId: student.student_id, overall: overall.overall_percentage })
  }

  const byStudent = new Map<string, GradesResponse>()
  for (const student of students) {
    const subjectGrades = subjectGradesByStudent.get(student.student_id) ?? []
    const overall = computeOverall(subjectGrades, context.bands)
    const peerPcts = overalls.map((o) => o.overall)
    const rank = denseRank(overall.overall_percentage, peerPcts)
    byStudent.set(student.student_id, {
      term_id: termId,
      student_id: student.student_id,
      overall_percentage: overall.overall_percentage,
      overall_gpa: overall.overall_gpa,
      letter: overall.letter,
      class_rank: rank,
      class_size: students.length,
      subjects: subjectGrades,
    })
  }

  return { byStudent, context }
}

export async function computeStudentGrades(
  schoolId: string,
  studentId: string,
  termId: string,
): Promise<{ grades: GradesResponse | null; sectionId: string | null }> {
  const sectionRes = await pool.query(
    `SELECT e.section_id
       FROM enrollments e
      WHERE e.student_id = $1
        AND e.academic_year_id = (SELECT academic_year_id FROM terms WHERE id = $2)
        AND e.left_on IS NULL
      LIMIT 1`,
    [studentId, termId],
  )
  const sectionId = sectionRes.rows[0]?.section_id as string | undefined
  if (!sectionId) return { grades: null, sectionId: null }

  const { byStudent } = await computeSectionGrades(schoolId, sectionId, termId)
  return { grades: byStudent.get(studentId) ?? null, sectionId }
}
