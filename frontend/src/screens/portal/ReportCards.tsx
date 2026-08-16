import { useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector, usePortalStudentName } from './PortalStudentSelector'
import { Button, Card, CardBody, EmptyState, ErrorState, LoadingBlock, StatusBadge } from '../../components'
import { ReportCardView } from '../../components/ReportCardView'

export function PortalReportCards() {
  const { studentId } = usePortalStudent()
  const studentName = usePortalStudentName()
  const cards = useAsyncData(
    () => (studentId ? scholarionApi.reportCards.studentList(studentId) : Promise.resolve([])),
    [studentId],
  )
  const [openId, setOpenId] = useState('')

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Report cards</h1>
          <p className="page-subtitle">{studentName ? `${studentName} · ` : ''}Published and draft term report cards.</p>
        </div>
        <PortalStudentSelector />
      </div>

      <Card>
        <CardBody>
          {!studentId ? (
            <EmptyState title="No student" description="No student is linked to this account." />
          ) : cards.loading ? (
            <LoadingBlock />
          ) : cards.error ? (
            <ErrorState description={cards.error.message} />
          ) : !cards.data?.length ? (
            <EmptyState title="No report cards" description="No report cards have been published yet." />
          ) : (
            <div className="stack">
              {cards.data.map((card) => (
                <div key={card.id} className="card-body" style={{ border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)' }}>
                  <div className="row-between">
                    <div className="row" style={{ gap: 'var(--sch-space-3)' }}>
                      <StatusBadge status={card.status} />
                      <span style={{ fontWeight: '600' }}>{card.term_name ?? card.term?.name ?? 'Term'}</span>
                      {card.version > 1 ? <span className="muted">v{card.version}</span> : null}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(openId === card.id ? '' : card.id)}>
                      {openId === card.id ? 'Hide' : 'View'}
                    </Button>
                  </div>
                  {openId === card.id ? (
                    <div className="mt-3">
                      <ReportCardView reportCard={card} studentName={studentName} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
