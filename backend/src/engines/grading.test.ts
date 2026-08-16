import { describe, expect, it } from 'vitest'
import {
  computeOverall,
  computeSubjectGrade,
  creditWeightedMean,
  denseRank,
  findBand,
} from './grading.js'
import type { BandInput, CategoryInput, AssessmentInput, MarkInput, SubjectGrade } from './grading.js'

const SCALE: BandInput[] = [
  { min: 0, max: 50, letter: 'F', gpa: 0, remark: 'Fail' },
  { min: 50, max: 70, letter: 'C', gpa: 2, remark: 'Credit' },
  { min: 70, max: 85, letter: 'B', gpa: 3, remark: 'Good' },
  { min: 85, max: 101, letter: 'A', gpa: 4, remark: 'Excellent' },
]

function grade(input: {
  categories: CategoryInput[]
  assessments: AssessmentInput[]
  marks: Record<string, MarkInput>
}): SubjectGrade {
  return computeSubjectGrade({
    subjectId: 'math',
    subjectName: 'Mathematics',
    subjectCode: 'MATH',
    creditHours: 3,
    categories: input.categories,
    assessments: input.assessments,
    marks: input.marks,
    bands: SCALE,
  })
}

describe('grading engine — category aggregation', () => {
  it('computes categoryPct as Σ(score)/Σ(max_score) × 100', () => {
    const result = grade({
      categories: [{ id: 'exams', name: 'Exams', weight_pct: 100, drop_lowest: 0 }],
      assessments: [
        { id: 'a1', category_id: 'exams', title: 'Midterm', max_score: 100 },
        { id: 'a2', category_id: 'exams', title: 'Final', max_score: 50 },
      ],
      marks: {
        a1: { score: 80, is_absent: false, is_excused: false },
        a2: { score: 45, is_absent: false, is_excused: false },
      },
    })

    expect(result.percentage).toBe(83.33)
    expect(result.letter).toBe('B')
    expect(result.trace[0].category_pct).toBe(83.33)
  })

  it('drops the N lowest percentages within a category', () => {
    const result = grade({
      categories: [{ id: 'quizzes', name: 'Quizzes', weight_pct: 100, drop_lowest: 1 }],
      assessments: [
        { id: 'q1', category_id: 'quizzes', title: 'Q1', max_score: 20 },
        { id: 'q2', category_id: 'quizzes', title: 'Q2', max_score: 20 },
        { id: 'q3', category_id: 'quizzes', title: 'Q3', max_score: 20 },
      ],
      marks: {
        q1: { score: 20, is_absent: false, is_excused: false },
        q2: { score: 12, is_absent: false, is_excused: false },
        q3: { score: 8, is_absent: false, is_excused: false },
      },
    })

    expect(result.percentage).toBe(80)
    const entries = result.trace[0].entries
    expect(entries.find((e) => e.assessment_id === 'q3')?.is_dropped).toBe(true)
    expect(entries.filter((e) => e.is_dropped)).toHaveLength(1)
  })

  it('excludes excused marks from numerator and denominator', () => {
    const result = grade({
      categories: [{ id: 'exams', name: 'Exams', weight_pct: 100, drop_lowest: 0 }],
      assessments: [
        { id: 'a1', category_id: 'exams', title: 'Midterm', max_score: 50 },
        { id: 'a2', category_id: 'exams', title: 'Final', max_score: 50 },
      ],
      marks: {
        a1: { score: 40, is_absent: false, is_excused: false },
        a2: { score: null, is_absent: false, is_excused: true },
      },
    })

    expect(result.percentage).toBe(80)
  })

  it('scores an absent (non-excused) mark as 0', () => {
    const result = grade({
      categories: [{ id: 'exams', name: 'Exams', weight_pct: 100, drop_lowest: 0 }],
      assessments: [
        { id: 'a1', category_id: 'exams', title: 'Midterm', max_score: 100 },
        { id: 'a2', category_id: 'exams', title: 'Final', max_score: 100 },
      ],
      marks: {
        a1: { score: null, is_absent: true, is_excused: false },
        a2: { score: 100, is_absent: false, is_excused: false },
      },
    })

    expect(result.percentage).toBe(50)
  })
})

describe('grading engine — weights and renormalization', () => {
  it('renormalizes remaining weights when a category is empty', () => {
    const result = grade({
      categories: [
        { id: 'hw', name: 'Homework', weight_pct: 40, drop_lowest: 1 },
        { id: 'exams', name: 'Exams', weight_pct: 60, drop_lowest: 0 },
      ],
      assessments: [
        { id: 'h1', category_id: 'hw', title: 'HW1', max_score: 10 },
        { id: 'e1', category_id: 'exams', title: 'Exam', max_score: 100 },
      ],
      marks: {
        h1: { score: 8, is_absent: false, is_excused: false },
        e1: { score: 90, is_absent: false, is_excused: false },
      },
    })

    // Homework's only assessment is dropped → category empty → excluded.
    // Exams renormalized to 100% weight → subject = 90.
    expect(result.percentage).toBe(90)
    const exams = result.trace.find((t) => t.category_id === 'exams')
    expect(exams?.renormalized_weight_pct).toBe(100)
  })

  it('applies a weight_override_pct as a standalone weighted item', () => {
    const result = grade({
      categories: [{ id: 'exams', name: 'Exams', weight_pct: 100, drop_lowest: 0 }],
      assessments: [
        { id: 'a1', category_id: 'exams', title: 'Midterm', max_score: 100 },
        { id: 'a2', category_id: 'exams', title: 'Project', max_score: 50, weight_override_pct: 20 },
      ],
      marks: {
        a1: { score: 80, is_absent: false, is_excused: false },
        a2: { score: 50, is_absent: false, is_excused: false },
      },
    })

    // Exams (weight 100) at 80%, Project (weight 20) at 100%.
    // (80*100 + 100*20) / 120 = 10000/120 = 83.33
    expect(result.percentage).toBe(83.33)
  })
})

describe('grading engine — banding, GPA, rank', () => {
  it('assigns letter and GPA from the band containing the percentage', () => {
    expect(findBand(85, SCALE)?.letter).toBe('A')
    expect(findBand(70, SCALE)?.letter).toBe('B')
    expect(findBand(50, SCALE)?.letter).toBe('C')
    expect(findBand(49.9, SCALE)?.letter).toBe('F')
    expect(findBand(100, SCALE)?.letter).toBe('A')
  })

  it('computes credit-hour-weighted overall percentage', () => {
    const overall = creditWeightedMean([
      { value: 90, credit_hours: 3 },
      { value: 80, credit_hours: 2 },
      { value: 70, credit_hours: 1 },
    ])
    expect(overall).toBe(83.33)
  })

  it('computes credit-hour-weighted GPA', () => {
    const overall = creditWeightedMean([
      { value: 4, credit_hours: 3 },
      { value: 3, credit_hours: 2 },
      { value: 2, credit_hours: 1 },
    ])
    expect(overall).toBe(3.33)
  })

  it('dense-ranks with ties sharing a rank', () => {
    const values = [90, 85, 85, 80]
    expect(denseRank(90, values)).toBe(1)
    expect(denseRank(85, values)).toBe(2)
    expect(denseRank(80, values)).toBe(3)
  })

  it('computes credit-weighted overall across subjects', () => {
    const subjects: SubjectGrade[] = [
      { subject_id: 'm', subject_name: 'Math', subject_code: 'MATH', credit_hours: 3, percentage: 90, letter: 'A', gpa: 4, weight_pct: 3, trace: [] },
      { subject_id: 'e', subject_name: 'English', subject_code: 'ENG', credit_hours: 2, percentage: 80, letter: 'B', gpa: 3, weight_pct: 2, trace: [] },
      { subject_id: 'a', subject_name: 'Art', subject_code: 'ART', credit_hours: 1, percentage: 60, letter: 'C', gpa: 2, weight_pct: 1, trace: [] },
    ]
    const overall = computeOverall(subjects, SCALE)
    expect(overall.overall_percentage).toBe(81.67)
    expect(overall.overall_gpa).toBe(3.33)
    expect(overall.letter).toBe('B')
  })
})
