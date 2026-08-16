import { useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useTeacherStaffId, uniqueSectionIds } from '../../lib/useTeacherStaffId'
import { fullName } from '../../lib/format'
import type { AttendanceStatus, AttendanceSession } from '../../lib/types'
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
  Select,
  useToast,
} from '../../components'

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused', 'sick']

function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function AttendanceMarker() {
  const { toast } = useToast()
  const staffId = useTeacherStaffId()
  const slots = useAsyncData(
    () => (staffId ? scholarionApi.timetable.teacherTimetable(staffId) : Promise.resolve([])),
    [staffId],
  )
  const sections = useAsyncData(() => scholarionApi.sections.list())
  const periods = useAsyncData(() => scholarionApi.periods.list())
  const sectionIds = useMemo(() => uniqueSectionIds(slots.data ?? []), [slots.data])

  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [periodId, setPeriodId] = useState('')
  const [session, setSession] = useState<AttendanceSession | null>(null)
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  const effectiveSection = sectionId || sectionIds[0] || ''
  const effectivePeriod = periodId || (periods.data ?? []).find((p) => !p.is_break)?.id || ''

  const roster = useAsyncData(
    () => (effectiveSection ? scholarionApi.sections.roster(effectiveSection) : Promise.resolve([])),
    [effectiveSection],
  )

  const sectionOptions = (sections.data ?? []).filter((s) => sectionIds.includes(s.id))

  const openSession = async () => {
    setSaving(true)
    try {
      const created = await scholarionApi.attendance.createSession({
        sectionId: effectiveSection,
        date,
        periodId: effectivePeriod || undefined,
      })
      setSession(created)
      const defaults: Record<string, AttendanceStatus> = {}
      for (const e of roster.data ?? []) defaults[e.student_id] = 'present'
      setStatuses(defaults)
      toast('Session ready')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to open session', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!session) return
    setSaving(true)
    try {
      const records = (roster.data ?? []).map((e) => ({
        studentId: e.student_id,
        status: statuses[e.student_id] ?? 'present',
      }))
      await scholarionApi.attendance.putRecords(session.id, records)
      toast('Attendance saved')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save attendance', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const finalize = async () => {
    if (!session) return
    setFinalizing(true)
    try {
      await scholarionApi.attendance.finalize(session.id)
      toast('Session finalized')
      setSession({ ...session, is_finalized: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to finalize', 'danger')
    } finally {
      setFinalizing(false)
    }
  }

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setStatuses((prev) => ({ ...prev, [studentId]: status }))
  }

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Take attendance for a section and date.</p>
        </div>
      </div>

      <Card>
        <CardHeader title="Session" />
        <CardBody>
          <div className="grid grid-3" style={{ alignItems: 'end' }}>
            <Field label="Section" required>
              <Select value={effectiveSection} onChange={(e) => { setSectionId(e.target.value); setSession(null) }} aria-label="Section">
                {sectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.grade_level?.name} {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSession(null) }} />
            </Field>
            <Field label="Period">
              <Select value={effectivePeriod} onChange={(e) => { setPeriodId(e.target.value); setSession(null) }} aria-label="Period">
                {(periods.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.starts_at?.slice(0, 5)}
                    {p.is_break ? ' (break)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="row mt-3">
            <Button onClick={() => void openSession()} loading={saving} disabled={!effectiveSection}>
              {session ? 'Re-open session' : 'Start attendance'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {!effectiveSection ? (
        <EmptyState title="No assigned sections" description="You have no teaching assignments yet." />
      ) : roster.loading ? (
        <LoadingBlock label="Loading roster…" />
      ) : roster.error ? (
        <ErrorState description={roster.error.message} />
      ) : !roster.data?.length ? (
        <EmptyState title="No students" />
      ) : (
        <Card>
          <CardHeader
            title="Mark attendance"
            subtitle={session?.is_finalized ? 'This session is finalized.' : undefined}
            actions={
              session ? (
                <div className="row">
                  <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={session.is_finalized}>
                    Save
                  </Button>
                  <Button variant="secondary" onClick={() => void finalize()} loading={finalizing} disabled={session.is_finalized}>
                    Finalize
                  </Button>
                </div>
              ) : (
                <span className="muted">Start a session to mark attendance.</span>
              )
            }
          />
          <CardBody>
            {!session ? (
              <EmptyState title="No open session" description="Start attendance above to record statuses." />
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Roll no.</th>
                      <th>Name</th>
                      <th>Admission no.</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.data.map((e) => {
                      const status = statuses[e.student_id] ?? 'present'
                      return (
                        <tr key={e.id}>
                          <td>{e.roll_no ?? '\u2014'}</td>
                          <td>{fullName(e.student?.first_name, e.student?.last_name)}</td>
                          <td>{e.student?.admission_no ?? '\u2014'}</td>
                          <td>
                            <div className="row" style={{ gap: 'var(--sch-space-1)', flexWrap: 'wrap' }} role="group" aria-label={`Status for ${fullName(e.student?.first_name, e.student?.last_name)}`}>
                              {STATUSES.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`}
                                  aria-pressed={status === s}
                                  disabled={session.is_finalized}
                                  onClick={() => setStatus(e.student_id, s)}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
