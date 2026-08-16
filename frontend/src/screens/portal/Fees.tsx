import { useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { usePortalStudent } from '../../lib/portal'
import { PortalStudentSelector, usePortalStudentName } from './PortalStudentSelector'
import { formatDate, formatMinor } from '../../lib/format'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, StatusBadge, Tabs } from '../../components'

export function PortalFees() {
  const { studentId } = usePortalStudent()
  const studentName = usePortalStudentName()
  const { currency, timezone, locale } = useAuth()
  const [tab, setTab] = useState('invoices')

  const invoices = useAsyncData(() => scholarionApi.invoices.list({ pageSize: 100 }))
  const ledger = useAsyncData(
    () => (studentId ? scholarionApi.ledger(studentId) : Promise.resolve(null)),
    [studentId],
  )

  const summary = ledger.data

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fees</h1>
          <p className="page-subtitle">{studentName ? `${studentName} · ` : ''}Invoices and account statement.</p>
        </div>
        <PortalStudentSelector />
      </div>

      <div className="grid grid-3">
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Outstanding</div>
            <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>
              {formatMinor(summary?.outstanding_minor, currency)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Total billed</div>
            <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>
              {formatMinor(summary?.total_debit_minor, currency)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Total paid</div>
            <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>
              {formatMinor(summary?.total_credit_minor, currency)}
            </div>
          </CardBody>
        </Card>
      </div>

      <Tabs
        ariaLabel="Fees sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'invoices', label: 'Invoices' },
          { id: 'ledger', label: 'Statement' },
        ]}
      />

      {tab === 'invoices' ? (
        <Card>
          <CardHeader title="Invoices" />
          <CardBody>
            {invoices.loading ? (
              <LoadingBlock />
            ) : invoices.error ? (
              <ErrorState description={invoices.error.message} />
            ) : !invoices.data?.items.length ? (
              <EmptyState title="No invoices" />
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Student</th>
                      <th>Due</th>
                      <th className="num">Total</th>
                      <th className="num">Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.items.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.number}</td>
                        <td>{`${inv.student?.first_name ?? ''} ${inv.student?.last_name ?? ''}`}</td>
                        <td>{formatDate(inv.due_date, { timezone, locale })}</td>
                        <td className="num">{formatMinor(inv.total_minor, currency)}</td>
                        <td className="num">{formatMinor(inv.balance_minor, currency)}</td>
                        <td>
                          <StatusBadge status={inv.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'ledger' ? (
        <Card>
          <CardHeader title="Account statement" />
          <CardBody>
            {!studentId ? (
              <EmptyState title="No student" description="No student is linked to this account." />
            ) : ledger.loading ? (
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
                        <td>{e.kind}</td>
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
    </div>
  )
}
