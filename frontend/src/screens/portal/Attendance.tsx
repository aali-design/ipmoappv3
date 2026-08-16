import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector, usePortalStudentName } from './PortalStudentSelector'
import type { AttendanceSummary } from '../../lib/types'
import { Card, CardBody, EmptyState, ErrorState, LoadingBlock } from '../../components'
import { AttendanceRing } from '../../components/AttendanceRing'

export function PortalAttendance() {
  const { studentId } = usePortalStudent()
  const studentName = usePortalStudentName()
  const profile = useAsyncData(
    () => (studentId ? scholarionApi.students.profile(studentId) : Promise.resolve(null)),
    [studentId],
  )

  const attendance = profile.data?.attendance ?? null

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">{studentName ? `${studentName} · ` : ''}Current term attendance summary.</p>
        </div>
        <PortalStudentSelector />
      </div>

      <Card>
        <CardBody>
          {!studentId ? (
            <EmptyState title="No student" description="No student is linked to this account." />
          ) : profile.loading ? (
            <LoadingBlock />
          ) : profile.error ? (
            <ErrorState description={profile.error.message} />
          ) : !attendance ? (
            <EmptyState title="No attendance" description="No attendance records yet for the current term." />
          ) : (
            <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sch-space-8)', flexWrap: 'wrap' }}>
              <AttendanceRing percent={attendance.percentage ?? attendance.attendance_pct ?? 0} />
              <div className="flex-1" style={{ minWidth: '16rem' }}>
                <SummaryGrid summary={attendance} />
                {(attendance.percentage ?? attendance.attendance_pct ?? 100) < 75 ? (
                  <div className="alert alert-warning mt-3">
                    Attendance is below the 75% minimum threshold. Your child may be flagged exam-ineligible.
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function SummaryGrid({ summary }: { summary: AttendanceSummary }) {
  const total = summary.total ?? summary.present + summary.absent + summary.late + summary.excused + summary.sick
  const rows = [
    { label: 'Present', value: summary.present },
    { label: 'Absent', value: summary.absent },
    { label: 'Late', value: summary.late },
    { label: 'Excused', value: summary.excused },
    { label: 'Sick', value: summary.sick },
    { label: 'Total', value: total },
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
