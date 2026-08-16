import { useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useTeacherStaffId, uniqueSectionIds } from '../../lib/useTeacherStaffId'
import { fullName } from '../../lib/format'
import type { Enrollment, ReportCard, Section } from '../../lib/types'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Modal,
  Select,
  StatusBadge,
  useToast,
} from '../../components'
import { ReportCardView } from '../../components/ReportCardView'

export function TeacherReportCards() {
  const staffId = useTeacherStaffId()
  const slots = useAsyncData(
    () => (staffId ? scholarionApi.timetable.teacherTimetable(staffId) : Promise.resolve([])),
    [staffId],
  )
  const sections = useAsyncData(() => scholarionApi.sections.list())
  const terms = useAsyncData(() => scholarionApi.terms.list())
  const sectionIds = useMemo(() => uniqueSectionIds(slots.data ?? []), [slots.data])

  const [sectionId, setSectionId] = useState('')
  const [termId, setTermId] = useState('')
  const [student, setStudent] = useState<Enrollment | null>(null)

  const effectiveSection = sectionId || sectionIds[0] || ''
  const activeTerm = terms.data?.find((t) => t.status === 'active') ?? terms.data?.[0]
  const effectiveTerm = termId || activeTerm?.id || ''

  const roster = useAsyncData(
    () => (effectiveSection ? scholarionApi.sections.roster(effectiveSection) : Promise.resolve([])),
    [effectiveSection],
  )

  const sectionOptions = (sections.data ?? []).filter((s) => sectionIds.includes(s.id))
  const selectedSection = sectionOptions.find((s) => s.id === effectiveSection)

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Report cards</h1>
          <p className="page-subtitle">Review and submit draft report cards for your students.</p>
        </div>
      </div>

      <Card>
        <CardBody>
          <div className="grid grid-2" style={{ alignItems: 'end' }}>
            <Field label="Section" required>
              <Select value={effectiveSection} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
                {sectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.grade_level?.name} {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Term">
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

      <Card>
        <CardHeader title="Students" />
        <CardBody>
          {!effectiveSection ? (
            <EmptyState title="No assigned sections" description="You have no teaching assignments yet." />
          ) : roster.loading ? (
            <LoadingBlock label="Loading roster…" />
          ) : roster.error ? (
            <ErrorState description={roster.error.message} />
          ) : !roster.data?.length ? (
            <EmptyState title="No students" />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Roll no.</th>
                    <th>Name</th>
                    <th>Admission no.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.data.map((e) => (
                    <tr key={e.id}>
                      <td>{e.roll_no ?? '\u2014'}</td>
                      <td>{fullName(e.student?.first_name, e.student?.last_name)}</td>
                      <td>{e.student?.admission_no ?? '\u2014'}</td>
                      <td className="cell-actions">
                        <Button variant="ghost" size="sm" onClick={() => setStudent(e)}>
                          Report cards
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {student ? (
        <StudentCardsModal
          student={student}
          section={selectedSection}
          onClose={() => setStudent(null)}
        />
      ) : null}
    </div>
  )
}

function StudentCardsModal({ student, section, onClose }: { student: Enrollment; section?: Section; onClose: () => void }) {
  const { toast } = useToast()
  const cards = useAsyncData(() => scholarionApi.reportCards.studentList(student.student_id), [student.student_id])
  const [openId, setOpenId] = useState('')
  const studentName = fullName(student.student?.first_name, student.student?.last_name)
  const sectionName = section ? `${section.grade_level?.name ?? ''} ${section.name}`.trim() : undefined

  const submit = async (card: ReportCard) => {
    try {
      await scholarionApi.reportCards.submit(card.id)
      toast('Report card submitted')
      cards.refetch()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to submit', 'danger')
    }
  }

  return (
    <Modal open title={`Report cards — ${studentName}`} onClose={onClose} wide>
      <div className="stack">
        {cards.loading ? (
          <LoadingBlock />
        ) : cards.error ? (
          <ErrorState description={cards.error.message} />
        ) : !cards.data?.length ? (
          <EmptyState title="No report cards" description="No report cards have been generated for this student yet." />
        ) : (
          cards.data.map((card) => (
            <div key={card.id} className="card-body" style={{ border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)' }}>
              <div className="row-between">
                <div className="row" style={{ gap: 'var(--sch-space-3)' }}>
                  <StatusBadge status={card.status} />
                  <span style={{ fontWeight: '600' }}>{card.term_name ?? card.term?.name ?? 'Term'}</span>
                  {card.version > 1 ? <span className="muted">v{card.version}</span> : null}
                </div>
                <div className="row">
                  <Button variant="ghost" size="sm" onClick={() => setOpenId(openId === card.id ? '' : card.id)}>
                    {openId === card.id ? 'Hide' : 'View'}
                  </Button>
                  {card.status === 'draft' ? (
                    <Button size="sm" onClick={() => void submit(card)}>
                      Submit
                    </Button>
                  ) : null}
                </div>
              </div>
              {openId === card.id ? (
                <div className="mt-3">
                  <ReportCardView reportCard={card} studentName={studentName} sectionName={sectionName} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
