import { useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatDateTime, titleCase } from '../../lib/format'
import { Card, CardBody, EmptyState, ErrorState, LoadingBlock, Pagination, Select } from '../../components'

const PAGE_SIZE = 50

export function AuditLog() {
  const { timezone, locale } = useAuth()
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('')

  const params = useMemo(() => ({ page, pageSize: PAGE_SIZE, entityType: entity || undefined }), [page, entity])
  const log = useAsyncData(() => scholarionApi.auditLog(params), [JSON.stringify(params)])

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p className="page-subtitle">Immutable, append-only record of every action.</p>
        </div>
        <div className="page-actions">
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1) }} aria-label="Filter by entity">
            <option value="">All entities</option>
            {['student', 'enrollment', 'timetable_slot', 'attendance_session', 'mark', 'report_card', 'invoice', 'payment', 'term', 'announcement'].map((e) => (
              <option key={e} value={e}>{titleCase(e)}</option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardBody>
          {log.loading ? (
            <LoadingBlock />
          ) : log.error ? (
            <ErrorState description={log.error.message} />
          ) : !log.data?.items.length ? (
            <EmptyState title="No audit entries" />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Entity ID</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {log.data.items.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDateTime(e.created_at, { timezone, locale })}</td>
                      <td>{e.actor?.full_name ?? '\u2014'}</td>
                      <td>{e.action}</td>
                      <td>{e.entity_type}</td>
                      <td style={{ maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.entity_id ?? '\u2014'}</td>
                      <td>{e.ip ?? '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {log.data && log.data.total > PAGE_SIZE ? (
            <div className="mt-3">
              <Pagination page={log.data.page} pageSize={log.data.pageSize} total={log.data.total} onPage={setPage} />
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
