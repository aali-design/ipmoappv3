import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { PortalStudentSelector } from './PortalStudentSelector'
import { formatDate } from '../../lib/format'
import { Button, Card, CardBody, EmptyState, ErrorState, LoadingBlock, useToast } from '../../components'

export function PortalAnnouncements() {
  const { timezone, locale } = useAuth()
  const { toast } = useToast()
  const list = useAsyncData(() => scholarionApi.announcements.list())

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">School news and notices relevant to you.</p>
        </div>
        <PortalStudentSelector />
      </div>

      <Card>
        <CardBody>
          {list.loading ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorState description={list.error.message} />
          ) : !list.data?.length ? (
            <EmptyState title="No announcements" description="There are no announcements right now." />
          ) : (
            <div className="stack">
              {list.data.map((a) => (
                <div key={a.id} className="card-body" style={{ border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)' }}>
                  <div className="row-between">
                    <span style={{ fontWeight: '600' }}>{a.title}</span>
                    <span className="muted">{formatDate(a.publish_at ?? undefined, { timezone, locale })}</span>
                  </div>
                  <p className="mt-1">{a.body}</p>
                  <div className="row">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        scholarionApi.announcements
                          .markRead(a.id)
                          .then(() => toast('Marked as read'))
                          .catch(() => toast('Could not mark as read', 'danger'))
                      }}
                    >
                      Mark as read
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
