import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector, usePortalStudentName } from './PortalStudentSelector'
import { formatDate } from '../../lib/format'
import { Card, CardBody, EmptyState, ErrorState, LoadingBlock } from '../../components'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PortalDocuments() {
  const { studentId } = usePortalStudent()
  const studentName = usePortalStudentName()
  const { timezone, locale } = useAuth()
  const profile = useAsyncData(
    () => (studentId ? scholarionApi.students.profile(studentId) : Promise.resolve(null)),
    [studentId],
  )

  const documents = profile.data?.documents ?? []

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">{studentName ? `${studentName} · ` : ''}Files shared with you by the school.</p>
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
          ) : !documents.length ? (
            <EmptyState title="No documents" description="The school has not shared any documents yet." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th className="num">Size</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td>{d.filename}</td>
                      <td>{d.content_type}</td>
                      <td className="num">{formatBytes(d.size_bytes)}</td>
                      <td>{formatDate(d.created_at, { timezone, locale })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
