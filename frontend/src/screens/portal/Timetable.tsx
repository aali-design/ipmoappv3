import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector } from './PortalStudentSelector'
import type { Period, TimetableSlot } from '../../lib/types'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock } from '../../components'
import { TimetableGrid } from '../../components/TimetableGrid'

/** Build a period list from the slots themselves (students can't read /periods). */
function periodsFromSlots(slots: TimetableSlot[]): Period[] {
  const byId = new Map<string, { period_label?: string; starts_at?: string; ends_at?: string; period_id: string }>()
  for (const s of slots) {
    if (!byId.has(s.period_id)) {
      byId.set(s.period_id, {
        period_id: s.period_id,
        period_label: (s as { period_label?: string }).period_label,
        starts_at: (s as { starts_at?: string }).starts_at,
        ends_at: (s as { ends_at?: string }).ends_at,
      })
    }
  }
  return Array.from(byId.entries()).map(([id, meta], i) => ({
    id,
    academic_year_id: '',
    sequence: i + 1,
    label: meta.period_label ?? `P${i + 1}`,
    starts_at: meta.starts_at ?? '',
    ends_at: meta.ends_at ?? '',
    is_break: false,
  }))
}

export function PortalTimetable() {
  const { studentId } = usePortalStudent()
  const slots = useAsyncData(
    () => (studentId ? scholarionApi.timetable.studentTimetable(studentId) : Promise.resolve([])),
    [studentId],
  )

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Timetable</h1>
          <p className="page-subtitle">Your weekly schedule.</p>
        </div>
        <PortalStudentSelector />
      </div>

      <Card>
        <CardHeader title="Weekly schedule" />
        <CardBody>
          {!studentId ? (
            <EmptyState title="No student" description="No student is linked to this account." />
          ) : slots.loading ? (
            <LoadingBlock />
          ) : slots.error ? (
            <ErrorState description={slots.error.message} />
          ) : (
            <TimetableGrid periods={periodsFromSlots(slots.data ?? [])} slots={slots.data ?? []} showRoom />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
