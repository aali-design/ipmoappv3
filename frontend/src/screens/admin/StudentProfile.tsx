import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatDate, formatMinor, formatPercent, fullName } from '../../lib/format'
import type { StudentProfile as StudentProfileData } from '../../lib/types'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  StatusBadge,
  Tabs,
} from '../../components'
import { AttendanceRing } from '../../components/AttendanceRing'
import { TimetableGrid } from '../../components/TimetableGrid'
import { GradesTrace } from '../../components/GradesTrace'

export function StudentProfile() {
  const { id } = useParams<{ id: string }>()
  const { currency, timezone, locale } = useAuth()
  const [tab, setTab] = useState('overview')

  const profile = useAsyncData(() => scholarionApi.students.profile(id!), [id])
  const terms = useAsyncData(() => scholarionApi.terms.list())
  const [termId, setTermId] = useState<string>('')
  const grades = useAsyncData(
    () => (termId ? scholarionApi.grades(id!, { termId }) : Promise.resolve(null)),
    [id, termId],
  )
  const ledger = useAsyncData(() => scholarionApi.ledger(id!), [id])
  const timetable = useAsyncData(() => scholarionApi.timetable.studentTimetable(id!), [id])
  const periods = useAsyncData(() => scholarionApi.periods.list())

  if (profile.loading) return <LoadingBlock label="Loading student profile…" />
  if (profile.error || !profile.data) return <ErrorState description={profile.error?.message} />

  const s = profile.data.student
  const activeTerm = terms.data?.find((t) => t.status === 'active') ?? terms.data?.[0]

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {fullName(s.first_name, s.last_name)}
          </h1>
          <p className="page-subtitle">
            {s.admission_no} &middot; {s.grade?.name ?? '\u2014'} {s.section?.name ?? ''}
          </p>
        </div>
        <StatusBadge status={s.status} />
      </div>

      <div className="grid grid-4">
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Attendance</div>
            <div style={{ fontSize: 'var(--sch-font-size-xl)', fontWeight: '600' }}>
              {formatPercent(profile.data.attendance_pct)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Fees balance</div>
            <div style={{ fontSize: 'var(--sch-font-size-xl)', fontWeight: '600' }}>
              {formatMinor(profile.data.fees_balance_minor, currency)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Gender</div>
            <div>{s.gender ?? '\u2014'}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Date of birth</div>
            <div>{formatDate(s.date_of_birth, { timezone, locale })}</div>
          </CardBody>
        </Card>
      </div>

      <Tabs
        ariaLabel="Student profile sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'timetable', label: 'Timetable' },
          { id: 'attendance', label: 'Attendance' },
          { id: 'grades', label: 'Grades' },
          { id: 'fees', label: 'Fees & ledger' },
          { id: 'documents', label: 'Documents' },
        ]}
      />

      {tab === 'overview' ? <OverviewTab profile={profile.data} /> : null}
      {tab === 'timetable' ? (
        <Card>
          <CardHeader title="Weekly timetable" />
          <CardBody>
            {timetable.loading ? (
              <LoadingBlock />
            ) : timetable.error ? (
              <ErrorState description={timetable.error.message} />
            ) : (
              <TimetableGrid periods={periods.data ?? []} slots={timetable.data ?? []} showRoom />
            )}
          </CardBody>
        </Card>
      ) : null}
      {tab === 'attendance' ? (
        <Card>
          <CardBody className="row" style={{ alignItems: 'flex-start', gap: 'var(--sch-space-8)' }}>
            <AttendanceRing percent={profile.data.attendance_pct} />
            <div className="flex-1">
              <SummaryGrid summary={profile.data.attendance} />
              {profile.data.attendance_pct != null && profile.data.attendance_pct < 75 ? (
                <div className="alert alert-warning mt-3">Below the minimum attendance threshold (75%) and flagged exam-ineligible.</div>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
      {tab === 'grades' ? (
        <Card>
          <CardHeader
            title="Grades"
            actions={
              <select className="select" value={termId || activeTerm?.id || ''} onChange={(e) => setTermId(e.target.value)} style={{ maxWidth: '12rem' }} aria-label="Term">
                {(terms.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            }
          />
          <CardBody>
            {!termId && !activeTerm ? (
              <EmptyState title="No terms" description="No academic terms are available." />
            ) : grades.loading ? (
              <LoadingBlock />
            ) : grades.error ? (
              <ErrorState description={grades.error.message} />
            ) : grades.data ? (
              <GradesTrace grades={grades.data} />
            ) : null}
          </CardBody>
        </Card>
      ) : null}
      {tab === 'fees' ? (
        <Card>
          <CardHeader title="Ledger statement" />
          <CardBody>
            {ledger.loading ? (
              <LoadingBlock />
            ) : ledger.error ? (
              <ErrorState description={ledger.error.message} />
            ) : !ledger.data || ledger.data.items.length === 0 ? (
              <EmptyState title="No ledger entries" />
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Kind</th>
                      <th>Memo</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.items.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.entry_date, { timezone, locale })}</td>
                        <td>
                          <Badge tone="neutral">{e.kind}</Badge>
                        </td>
                        <td>{e.memo ?? '\u2014'}</td>
                        <td className="num">{e.debit_minor ? formatMinor(e.debit_minor, currency) : '\u2014'}</td>
                        <td className="num">{e.credit_minor ? formatMinor(e.credit_minor, currency) : '\u2014'}</td>
                        <td className="num">{formatMinor(e.balance_after_minor, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
      {tab === 'documents' ? (
        <Card>
          <CardHeader title="Documents" />
          <CardBody>
            {!profile.data.documents?.length ? (
              <EmptyState title="No documents" />
            ) : (
              <div className="stack stack-sm">
                {profile.data.documents.map((d) => (
                  <div key={d.id} className="row-between">
                    <span>{d.filename}</span>
                    <span className="muted">{formatDate(d.created_at, { timezone, locale })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

function OverviewTab({ profile }: { profile: StudentProfileData }) {
  const { timezone, locale } = useAuth()
  const s = profile.student
  return (
    <div className="grid grid-2">
      <Card>
        <CardHeader title="Personal details" />
        <CardBody className="stack stack-sm">
          <Detail label="Admission no." value={s.admission_no} />
          <Detail label="Status" value={s.status} />
          <Detail label="Gender" value={s.gender ?? '\u2014'} />
          <Detail label="Nationality" value={s.nationality ?? '\u2014'} />
          <Detail label="Date of birth" value={formatDate(s.date_of_birth, { timezone, locale })} />
          <Detail label="Admitted on" value={formatDate(s.admitted_on, { timezone, locale })} />
          <Detail label="Medical notes" value={s.medical_notes ?? '\u2014'} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Enrolment" />
        <CardBody className="stack stack-sm">
          {profile.enrollment ? (
            <>
              <Detail label="Section" value={`${profile.enrollment.section?.grade_level?.name ?? ''} ${profile.enrollment.section?.name ?? ''}`} />
              <Detail label="Roll no." value={String(profile.enrollment.roll_no ?? '\u2014')} />
              <Detail label="Enrolled on" value={formatDate(profile.enrollment.enrolled_on, { timezone, locale })} />
              <Detail label="Status" value={profile.enrollment.status} />
            </>
          ) : (
            <p className="muted">Not enrolled in the current academic year.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Guardians" />
        <CardBody className="stack stack-sm">
          {profile.guardians?.length ? (
            profile.guardians.map((g) => (
              <div key={g.id} className="row-between">
                <span>
                  {g.full_name} <span className="muted">({g.relation})</span>
                </span>
                <span className="muted">{g.phone ?? ''}</span>
              </div>
            ))
          ) : (
            <p className="muted">No guardians on record.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Incidents" />
        <CardBody className="stack stack-sm">
          {profile.incidents?.length ? (
            profile.incidents.map((i) => (
              <div key={i.id} className="row-between">
                <span>{i.category}</span>
                <span className="muted">{formatDate(i.date, { timezone, locale })}</span>
              </div>
            ))
          ) : (
            <p className="muted">No incidents on record.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function SummaryGrid({ summary }: { summary: { present?: number; absent?: number; late?: number; excused?: number; sick?: number; total?: number } | null | undefined }) {
  if (!summary) return <p className="muted">No attendance summary.</p>
  const rows = [
    { label: 'Present', value: summary.present ?? 0 },
    { label: 'Absent', value: summary.absent ?? 0 },
    { label: 'Late', value: summary.late ?? 0 },
    { label: 'Excused', value: summary.excused ?? 0 },
    { label: 'Sick', value: summary.sick ?? 0 },
    { label: 'Total', value: summary.total ?? 0 },
  ]
  return (
    <div className="grid grid-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>{r.label}</div>
          <div style={{ fontWeight: '600' }}>{r.value}</div>
        </div>
      ))}
    </div>
  )
}
