import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatDateTime, formatMinor, formatPercent, minorToMajor } from '../../lib/format'
import { Alert, Card, CardBody, CardHeader, ErrorState, LoadingBlock, StatCard } from '../../components'
import { BarList } from '../../components/BarList'

export function Dashboard() {
  const { currency, timezone, locale, user } = useAuth()
  const { data, loading, error } = useAsyncData(() => scholarionApi.dashboard())

  if (loading) return <LoadingBlock label="Loading dashboard…" />
  if (error || !data) return <ErrorState description={error?.message} />

  const enrolmentRows = data.enrolment_by_grade.map((g) => ({ label: g.grade, value: g.count }))
  const agingRows = (data.aging_buckets ?? []).map((b) => ({
    label: b.bucket,
    value: Math.round(minorToMajor(b.amount_minor, currency)),
    tone: b.bucket.startsWith('90') ? ('danger' as const) : b.bucket.startsWith('61') ? ('warning' as const) : undefined,
  }))

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back, {user?.full_name}.</p>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Enrolled students" value={data.student_count.toLocaleString()} />
        <StatCard
          label="Today's attendance"
          value={formatPercent(data.today_attendance_pct)}
          delta={data.today_attendance_pct !== null && data.today_attendance_pct < 75 ? 'below threshold' : undefined}
          deltaTone={data.today_attendance_pct !== null && data.today_attendance_pct < 75 ? 'negative' : 'neutral'}
        />
        <StatCard label="Fees collected" value={formatMinor(data.fees_collected_minor, currency)} />
        <StatCard
          label="Fees outstanding"
          value={formatMinor(data.fees_outstanding_minor, currency)}
          delta={`${data.overdue_invoices} overdue invoices`}
          deltaTone={data.overdue_invoices > 0 ? 'negative' : 'neutral'}
        />
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHeader title="Enrolment by grade" subtitle="Current academic year" />
          <CardBody>
            {enrolmentRows.length ? <BarList rows={enrolmentRows} /> : <p className="muted">No enrolment data.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Aging receivables" subtitle="Days past due" />
          <CardBody>
            {agingRows.length ? <BarList rows={agingRows} /> : <p className="muted">No outstanding invoices.</p>}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHeader title="Upcoming events" />
          <CardBody className="stack stack-sm">
            {data.upcoming_events.length ? (
              data.upcoming_events.map((ev, i) => (
                <div key={i} className="row-between">
                  <span>{ev.title}</span>
                  <span className="muted">{formatDateTime(ev.date, { timezone, locale })}</span>
                </div>
              ))
            ) : (
              <p className="muted">No upcoming events.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <CardBody className="stack stack-sm">
            {data.recent_activity.length ? (
              data.recent_activity.map((a, i) => (
                <div key={i} className="row-between">
                  <span>{a.action}</span>
                  <span className="muted">{formatDateTime(a.at, { timezone, locale })}</span>
                </div>
              ))
            ) : (
              <p className="muted">No recent activity.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {data.overdue_invoices > 0 ? (
        <Alert tone="warning">
          {data.overdue_invoices} invoice{data.overdue_invoices === 1 ? '' : 's'} past due. Review the Fees section for details.
        </Alert>
      ) : null}
    </div>
  )
}
