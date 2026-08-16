/**
 * Grading engine (spec §6) — deterministic and explainable.
 *
 * Pure functions, no I/O. The route layer loads assessments/marks/categories
 * and the school's grading scale, then calls these helpers. Rounding is
 * half-up to 2 decimals and is delegated to the single shared helper in
 * `lib/rounding` — never re-implemented here.
 */

import { roundHalfUp } from '../lib/rounding.js'

export interface BandInput {
  min: number
  max: number
  letter: string
  gpa: number
  remark: string
}

export interface CategoryInput {
  id: string
  name: string
  weight_pct: number
  drop_lowest: number
}

export interface AssessmentInput {
  id: string
  title: string
  category_id: string
  max_score: number
  /** When set, this assessment leaves its category and is weighted on its own. */
  weight_override_pct?: number | null
  /** Present when loaded per subject; stripped before computeSubjectGrade. */
  subject_id?: string
}

export interface MarkInput {
  /** null when absent or not entered. */
  score: number | null
  is_absent: boolean
  is_excused: boolean
}

export interface GradeTraceEntry {
  assessment_id: string
  assessment_title: string
  category_id: string
  category_name: string
  category_weight_pct: number
  score: number | null
  max_score: number
  percentage: number | null
  is_dropped: boolean
  drop_reason: string | null
  is_excused: boolean
  is_absent: boolean
  weight_applied_pct: number
}

export interface GradeTraceCategory {
  category_id: string
  name: string
  weight_pct: number
  renormalized_weight_pct: number
  category_pct: number | null
  entries: GradeTraceEntry[]
}

export interface SubjectGrade {
  subject_id: string
  subject_name: string
  subject_code: string
  credit_hours: number
  percentage: number | null
  letter: string | null
  gpa: number | null
  weight_pct: number
  trace: GradeTraceCategory[]
}

export interface GradesResponse {
  term_id: string
  student_id: string
  overall_percentage: number | null
  overall_gpa: number | null
  letter: string | null
  class_rank: number | null
  class_size: number | null
  subjects: SubjectGrade[]
}

export interface OverallResult {
  overall_percentage: number | null
  overall_gpa: number | null
  letter: string | null
}

/** Locate the band containing `percentage`. Shared-boundary values belong to the higher band. */
export function findBand(percentage: number, bands: BandInput[]): BandInput | null {
  if (!bands || bands.length === 0) return null
  const sorted = [...bands].sort((a, b) => a.min - b.min)
  const last = sorted[sorted.length - 1]
  for (const band of sorted) {
    const isLast = band === last
    if (percentage >= band.min && (percentage < band.max || (isLast && percentage <= band.max))) {
      return band
    }
  }
  if (percentage < sorted[0].min) return sorted[0]
  return last
}

/**
 * Compute a single student's grade for one subject.
 *
 * - `is_excused` marks are excluded from numerator and denominator.
 * - `is_absent` (without excuse) scores 0.
 * - Each category drops its `drop_lowest` lowest percentages.
 * - `categoryPct = Σ(score) / Σ(max_score) × 100` over what remains.
 * - A category with no remaining assessments is excluded and the remaining
 *   weights are renormalized to 100.
 * - An assessment with `weight_override_pct` is pulled out of its category and
 *   weighted on its own at `weight_override_pct`.
 */
export function computeSubjectGrade(input: {
  subjectId: string
  subjectName: string
  subjectCode: string
  creditHours: number
  categories: CategoryInput[]
  assessments: AssessmentInput[]
  marks: Record<string, MarkInput>
  bands: BandInput[]
}): SubjectGrade {
  const { subjectId, subjectName, subjectCode, creditHours, categories, assessments, marks, bands } =
    input

  const assessmentsByCategory = new Map<string, AssessmentInput[]>()
  for (const a of assessments) {
    const list = assessmentsByCategory.get(a.category_id) ?? []
    list.push(a)
    assessmentsByCategory.set(a.category_id, list)
  }

  interface WeightedItem {
    pct: number | null
    weight: number
    trace: GradeTraceCategory
  }

  const weightedItems: WeightedItem[] = []

  // 1. Categories (non-overridden assessments).
  for (const cat of categories) {
    const catAssessments = (assessmentsByCategory.get(cat.id) ?? []).filter(
      (a) => a.weight_override_pct == null,
    )

    const entries: GradeTraceEntry[] = []
    interface ScoredEntry {
      entry: GradeTraceEntry
      percentage: number
    }
    const scored: ScoredEntry[] = []
    let sumScore = 0
    let sumMax = 0

    for (const a of catAssessments) {
      const mark = marks[a.id]
      if (!mark) continue // no mark for this student — not part of the computation

      const excused = mark.is_excused
      const absent = !excused && mark.is_absent
      const rawScore = mark.score ?? 0
      const numericPercentage = absent ? 0 : roundHalfUp((rawScore / a.max_score) * 100, 2)
      const percentage = excused ? null : numericPercentage

      const entry: GradeTraceEntry = {
        assessment_id: a.id,
        assessment_title: a.title,
        category_id: cat.id,
        category_name: cat.name,
        category_weight_pct: cat.weight_pct,
        score: mark.score,
        max_score: a.max_score,
        percentage,
        is_dropped: false,
        drop_reason: null,
        is_excused: excused,
        is_absent: absent,
        weight_applied_pct: cat.weight_pct,
      }
      entries.push(entry)

      if (!excused) {
        scored.push({ entry, percentage: numericPercentage })
        sumScore += rawScore
        sumMax += a.max_score
      }
    }

    // Drop the lowest `drop_lowest` percentages.
    scored.sort((x, y) => x.percentage - y.percentage)
    const dropCount = Math.min(cat.drop_lowest, scored.length)
    for (let i = 0; i < dropCount; i++) {
      const dropped = scored[i]
      dropped.entry.is_dropped = true
      dropped.entry.drop_reason = 'dropped-lowest'
      sumScore -= dropped.entry.score ?? 0
      sumMax -= dropped.entry.max_score
    }

    const categoryPct =
      scored.length - dropCount > 0 && sumMax > 0 ? roundHalfUp((sumScore / sumMax) * 100, 2) : null

    weightedItems.push({
      pct: categoryPct,
      weight: cat.weight_pct,
      trace: {
        category_id: cat.id,
        name: cat.name,
        weight_pct: cat.weight_pct,
        renormalized_weight_pct: cat.weight_pct,
        category_pct: categoryPct,
        entries,
      },
    })
  }

  // 2. Overridden assessments — each weighted on its own.
  for (const a of assessments) {
    if (a.weight_override_pct == null) continue
    const mark = marks[a.id]
    if (!mark) continue
    const excused = mark.is_excused
    const absent = !excused && mark.is_absent
    const percentage = excused
      ? null
      : absent
        ? 0
        : roundHalfUp(((mark.score ?? 0) / a.max_score) * 100, 2)

    const entry: GradeTraceEntry = {
      assessment_id: a.id,
      assessment_title: a.title,
      category_id: a.id,
      category_name: a.title,
      category_weight_pct: a.weight_override_pct ?? 0,
      score: mark.score,
      max_score: a.max_score,
      percentage,
      is_dropped: false,
      drop_reason: null,
      is_excused: excused,
      is_absent: absent,
      weight_applied_pct: a.weight_override_pct ?? 0,
    }

    weightedItems.push({
      pct: percentage,
      weight: a.weight_override_pct ?? 0,
      trace: {
        category_id: a.id,
        name: a.title,
        weight_pct: a.weight_override_pct ?? 0,
        renormalized_weight_pct: a.weight_override_pct ?? 0,
        category_pct: percentage,
        entries: [entry],
      },
    })
  }

  // 3. Renormalize weights across included items.
  const included = weightedItems.filter((item) => item.pct != null)
  const totalWeight = included.reduce((sum, item) => sum + item.weight, 0)

  const weightedSum = included.reduce(
    (sum, item) => sum + (item.pct as number) * item.weight,
    0,
  )

  for (const item of included) {
    item.trace.renormalized_weight_pct =
      totalWeight > 0 ? roundHalfUp((item.weight / totalWeight) * 100, 2) : 0
  }

  const percentage = totalWeight > 0 ? roundHalfUp(weightedSum / totalWeight, 2) : null
  const band = percentage != null ? findBand(percentage, bands) : null

  return {
    subject_id: subjectId,
    subject_name: subjectName,
    subject_code: subjectCode,
    credit_hours: creditHours,
    percentage,
    letter: band?.letter ?? null,
    gpa: band?.gpa ?? null,
    weight_pct: creditHours,
    trace: weightedItems.map((item) => item.trace),
  }
}

/** Credit-hour-weighted mean of a set of values. Returns null on empty/zero credit. */
export function creditWeightedMean(items: { value: number; credit_hours: number }[]): number | null {
  const totalCredit = items.reduce((sum, item) => sum + item.credit_hours, 0)
  if (totalCredit === 0) return null
  const weighted = items.reduce((sum, item) => sum + item.value * item.credit_hours, 0)
  return roundHalfUp(weighted / totalCredit, 2)
}

/** Credit-weighted overall percentage, GPA and letter across subjects. */
export function computeOverall(subjects: SubjectGrade[], bands: BandInput[]): OverallResult {
  const withPct = subjects.filter((s) => s.percentage != null)
  const withGpa = subjects.filter((s) => s.gpa != null)
  const overall_percentage = creditWeightedMean(
    withPct.map((s) => ({ value: s.percentage as number, credit_hours: s.credit_hours })),
  )
  const overall_gpa = creditWeightedMean(
    withGpa.map((s) => ({ value: s.gpa as number, credit_hours: s.credit_hours })),
  )
  const letter = overall_percentage != null ? (findBand(overall_percentage, bands)?.letter ?? null) : null
  return { overall_percentage, overall_gpa, letter }
}

/** Dense rank (1 = highest); ties share a rank. null values rank last. */
export function denseRank(value: number | null, values: (number | null)[]): number {
  const nonNull = values.filter((v): v is number => v != null)
  const uniqueDesc = [...new Set(nonNull)].sort((a, b) => b - a)
  if (value == null) return uniqueDesc.length === 0 ? 0 : uniqueDesc.length + 1
  const index = uniqueDesc.indexOf(value)
  return index === -1 ? uniqueDesc.length + 1 : index + 1
}
