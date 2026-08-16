import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useTeacherStaffId } from '../../lib/useTeacherStaffId'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock } from '../../components'
import { TimetableGrid } from '../../components/TimetableGrid'

export function TeacherTimetable() {
  const staffId = useTeacherStaffId()
  const slots = useAsyncData(
    () => (staffId ? scholarionApi.timetable.teacherTimetable(staffId) : Promise.resolve([])),
    [staffId],
  )
  const periods = useAsyncData(() => scholarionApi.periods.list())

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">My timetable</h1>
          <p className="page-subtitle">Your assigned teaching periods.</p>
        </div>
      </div>
      <Card>
        <CardHeader title="Weekly schedule" />
        <CardBody>
          {!staffId ? (
            <EmptyState title="No staff record" description="Your account is not linked to a staff record." />
          ) : slots.loading ? (
            <LoadingBlock />
          ) : slots.error ? (
            <ErrorState description={slots.error.message} />
          ) : (
            <TimetableGrid periods={periods.data ?? []} slots={slots.data ?? []} showRoom />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
