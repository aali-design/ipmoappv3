import { useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useTeacherStaffId, uniqueSectionIds } from '../../lib/useTeacherStaffId'
import type { Assessment, GradebookResponse } from '../../lib/types'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  useToast,
} from '../../components'

export function TeacherGradebook() {
  const staffId = useTeacherStaffId()
  const slots = useAsyncData(
    () => (staffId ? scholarionApi.timetable.teacherTimetable(staffId) : Promise.resolve([])),
    [staffId],
  )
  const sections = useAsyncData(() => scholarionApi.sections.list())
  const subjects = useAsyncData(() => scholarionApi.subjects.list())
  const terms = useAsyncData(() => scholarionApi.terms.list())
  const sectionIds = useMemo(() => uniqueSectionIds(slots.data ?? []), [slots.data])

  const [sectionId, setSectionId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [termId, setTermId] = useState('')
  const [editing, setEditing] = useState<Assessment | null>(null)

  const effectiveSection = sectionId || sectionIds[0] || ''
  const activeTerm = terms.data?.find((t) => t.status === 'active') ?? terms.data?.[0]
  const effectiveTerm = termId || activeTerm?.id || ''
  const effectiveSubject = subjectId || subjects.data?.[0]?.id || ''

  const gradebook = useAsyncData(
    () =>
      effectiveSection && effectiveSubject && effectiveTerm
        ? scholarionApi.gradebook({ sectionId: effectiveSection, subjectId: effectiveSubject, termId: effectiveTerm })
        : Promise.resolve(null),
    [effectiveSection, effectiveSubject, effectiveTerm],
  )

  const sectionOptions = (sections.data ?? []).filter((s) => sectionIds.includes(s.id))

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gradebook</h1>
          <p className="page-subtitle">Enter and review marks by subject and term.</p>
        </div>
      </div>

      <Card>
        <CardBody>
          <div className="grid grid-3" style={{ alignItems: 'end' }}>
            <Field label="Section" required>
              <Select value={effectiveSection} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
                {sectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.grade_level?.name} {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject" required>
              <Select value={effectiveSubject} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
                {(subjects.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Term" required>
              <Select value={effectiveTerm} onChange={(e) => setTermId(e.target.value)} aria-label="Term">
                {(terms.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      {!effectiveSection ? (
        <EmptyState title="No assigned sections" description="You have no teaching assignments yet." />
      ) : gradebook.loading ? (
        <LoadingBlock label="Loading gradebook…" />
      ) : gradebook.error ? (
        <ErrorState description={gradebook.error.message} />
      ) : !gradebook.data ? (
        <EmptyState title="No gradebook" description="Select a subject and term." />
      ) : (
        <GradebookGrid data={gradebook.data} onEdit={setEditing} />
      )}

      {editing ? (
        <MarksModal
          assessment={editing}
          data={gradebook.data ?? undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            gradebook.refetch()
          }}
        />
      ) : null}
    </div>
  )
}

function GradebookGrid({ data, onEdit }: { data: GradebookResponse; onEdit: (a: Assessment) => void }) {
  return (
    <Card>
      <CardHeader title="Marks grid" subtitle={`${data.rows.length} students · ${data.assessments.length} assessments`} />
      <CardBody>
        {data.rows.length === 0 ? (
          <EmptyState title="No students" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  {data.assessments.map((a) => (
                    <th key={a.id}>
                      <div>{a.title}</div>
                      <div className="muted" style={{ fontWeight: '400', textTransform: 'none' }}>
                        /{a.max_score}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => onEdit(a)} style={{ marginTop: 'var(--sch-space-1)' }}>
                        Edit
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.student_id}>
                    <td>
                      {row.student_name}
                      <span className="muted"> ({row.roll_no ?? row.admission_no})</span>
                    </td>
                    {data.assessments.map((a) => {
                      const mark = row.marks[a.id]
                      return (
                        <td key={a.id} className="num">
                          <MarkCell score={mark?.score ?? null} isAbsent={mark?.is_absent ?? false} isExcused={mark?.is_excused ?? false} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MarkCell({ score, isAbsent, isExcused }: { score: number | string | null; isAbsent: boolean; isExcused: boolean }) {
  if (isExcused) return <span className="muted">Excused</span>
  if (isAbsent) return <span className="muted">Absent</span>
  return <span>{score ?? '\u2014'}</span>
}

function MarksModal({ assessment, data, onClose, onSaved }: { assessment: Assessment; data?: GradebookResponse; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const rows = data?.rows ?? []
  const [values, setValues] = useState<Record<string, { score: string; absent: boolean; excused: boolean }>>(() => {
    const init: Record<string, { score: string; absent: boolean; excused: boolean }> = {}
    for (const r of rows) {
      const mark = r.marks[assessment.id]
      init[r.student_id] = {
        score: mark?.score != null ? String(mark.score) : '',
        absent: mark?.is_absent ?? false,
        excused: mark?.is_excused ?? false,
      }
    }
    return init
  })
  const [pending, setPending] = useState(false)

  const update = (studentId: string, patch: Partial<{ score: string; absent: boolean; excused: boolean }>) => {
    setValues((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }))
  }

  const save = async () => {
    setPending(true)
    try {
      const marks = rows.map((r) => {
        const v = values[r.student_id] ?? { score: '', absent: false, excused: false }
        const score = v.score === '' ? null : Number(v.score)
        return { studentId: r.student_id, score, isAbsent: v.absent, isExcused: v.excused }
      })
      await scholarionApi.assessments.putMarks(assessment.id, marks)
      toast('Marks saved')
      onSaved()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save marks', 'danger')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      title={`Enter marks — ${assessment.title}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending}>
            Save marks
          </Button>
        </>
      }
    >
      <p className="muted">Max score: {assessment.max_score}. Leave score blank and tick “absent” or “excused” as needed.</p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th className="num" style={{ width: '8rem' }}>Score</th>
              <th>Absent</th>
              <th>Excused</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = values[r.student_id] ?? { score: '', absent: false, excused: false }
              return (
                <tr key={r.student_id}>
                  <td>{r.student_name}</td>
                  <td>
                    <Input
                      type="number"
                      min={0}
                      max={Number(assessment.max_score)}
                      value={v.score}
                      aria-label={`Score for ${r.student_name}`}
                      onChange={(e) => update(r.student_id, { score: e.target.value })}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={v.absent} aria-label={`Absent ${r.student_name}`} onChange={(e) => update(r.student_id, { absent: e.target.checked, excused: false })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={v.excused} aria-label={`Excused ${r.student_name}`} onChange={(e) => update(r.student_id, { excused: e.target.checked, absent: false })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
