import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector, usePortalStudentName } from './PortalStudentSelector'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock } from '../../components'
import { GradesTrace } from '../../components/GradesTrace'

export function PortalGrades() {
  const { studentId } = usePortalStudent()
  const studentName = usePortalStudentName()
  const profile = useAsyncData(
    () => (studentId ? scholarionApi.students.profile(studentId) : Promise.resolve(null)),
    [studentId],
  )

  const grades = profile.data?.grades ?? null

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Grades</h1>
          <p className="page-subtitle">
            {studentName ? `${studentName} · ` : ''}
            {grades?.term_name ?? 'Current term'} — expand a subject to see the breakdown.
          </p>
        </div>
        <PortalStudentSelector />
      </div>

      <Card>
        <CardHeader title="Grade breakdown" />
        <CardBody>
          {!studentId ? (
            <EmptyState title="No student" description="No student is linked to this account." />
          ) : profile.loading ? (
            <LoadingBlock />
          ) : profile.error ? (
            <ErrorState description={profile.error.message} />
          ) : !grades ? (
            <EmptyState title="No grades" description="No grades have been recorded for the current term." />
          ) : (
            <GradesTrace grades={grades} />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
