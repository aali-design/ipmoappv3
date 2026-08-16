import { useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatDate, formatMinor, minorToMajor } from '../../lib/format'
import type { Invoice, Payment } from '../../lib/types'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Select,
  StatusBadge,
  Tabs,
  useToast,
} from '../../components'
import { BarList } from '../../components/BarList'

export function Fees() {
  const [tab, setTab] = useState('summary')
  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fees</h1>
          <p className="page-subtitle">Structures, invoices, payments and the ledger.</p>
        </div>
      </div>
      <Tabs
        ariaLabel="Fees sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'summary', label: 'Summary' },
          { id: 'structures', label: 'Structures' },
          { id: 'invoice-run', label: 'Invoice run' },
          { id: 'invoices', label: 'Invoices' },
          { id: 'payments', label: 'Record payment' },
        ]}
      />
      {tab === 'summary' ? <FeesSummary /> : null}
      {tab === 'structures' ? <FeeStructures /> : null}
      {tab === 'invoice-run' ? <InvoiceRun /> : null}
      {tab === 'invoices' ? <Invoices /> : null}
      {tab === 'payments' ? <RecordPayment /> : null}
    </div>
  )
}

function FeesSummary() {
  const { currency } = useAuth()
  const years = useAsyncData(() => scholarionApi.academicYears.list())
  const [yearId, setYearId] = useState('')
  const summary = useAsyncData(
    () => scholarionApi.feesSummary({ academicYearId: yearId || undefined }),
    [yearId],
  )

  const activeYear = years.data?.find((y) => y.is_current) ?? years.data?.[0]
  const effectiveYear = yearId || activeYear?.id || ''

  const agingRows = (summary.data?.aging_buckets ?? []).map((b) => ({
    label: b.bucket,
    value: Math.round(minorToMajor(b.amount_minor, currency)),
    tone: b.bucket.startsWith('90') ? ('danger' as const) : b.bucket.startsWith('61') ? ('warning' as const) : undefined,
  }))

  return (
    <div className="stack">
      <div className="toolbar">
        <Select value={effectiveYear} onChange={(e) => setYearId(e.target.value)} style={{ maxWidth: '16rem' }} aria-label="Academic year">
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
      </div>
      {summary.loading ? (
        <LoadingBlock />
      ) : summary.error ? (
        <ErrorState description={summary.error.message} />
      ) : !summary.data ? (
        <EmptyState title="No summary" />
      ) : (
        <>
          <div className="grid grid-4">
            <Card>
              <CardBody>
                <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Billed</div>
                <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>{formatMinor(summary.data.billed_minor, currency)}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Collected</div>
                <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)', color: 'var(--sch-color-success-600)' }}>{formatMinor(summary.data.collected_minor, currency)}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Outstanding</div>
                <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>{formatMinor(summary.data.outstanding_minor, currency)}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Overdue</div>
                <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)', color: 'var(--sch-color-danger-600)' }}>{formatMinor(summary.data.overdue_minor, currency)}</div>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Aging buckets" />
            <CardBody>{agingRows.length ? <BarList rows={agingRows} /> : <p className="muted">No outstanding invoices.</p>}</CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function FeeStructures() {
  const { currency } = useAuth()
  const structures = useAsyncData(() => scholarionApi.feeStructures.list())
  const [open, setOpen] = useState('')
  const selected = (structures.data ?? []).find((s) => s.id === open)

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card>
        <CardHeader title="Fee structures" />
        <CardBody className="stack stack-sm">
          {structures.loading ? (
            <LoadingBlock />
          ) : structures.error ? (
            <ErrorState description={structures.error.message} />
          ) : !structures.data?.length ? (
            <EmptyState title="No structures" />
          ) : (
            structures.data.map((s) => (
              <button
                key={s.id}
                className="row-between"
                style={{ width: '100%', padding: 'var(--sch-space-3)', background: open === s.id ? 'var(--sch-bg-inset)' : 'none', border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)', cursor: 'pointer' }}
                onClick={() => setOpen(s.id)}
              >
                <span style={{ fontWeight: '600' }}>{s.name}</span>
                <span className="muted">{s.items?.length ?? 0} items</span>
              </button>
            ))
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={selected ? selected.name : 'Structure items'} />
        <CardBody>
          {!selected ? (
            <p className="muted">Select a structure to view its items.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Frequency</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.items ?? []).map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.category}</td>
                      <td>{i.frequency}</td>
                      <td className="num">{formatMinor(i.amount_minor, currency)}</td>
                    </tr>
                  ))}
                  {!selected.items?.length ? (
                    <tr>
                      <td colSpan={4} className="muted">No items yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function InvoiceRun() {
  const { currency } = useAuth()
  const { toast } = useToast()
  const years = useAsyncData(() => scholarionApi.academicYears.list())
  const terms = useAsyncData(() => scholarionApi.terms.list())
  const grades = useAsyncData(() => scholarionApi.gradeLevels.list())

  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState('')
  const [gradeIds, setGradeIds] = useState<string[]>([])
  const [dryRun, setDryRun] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number; totalMinor?: number; invoices?: Invoice[] } | null>(null)

  const toggleGrade = (id: string) => {
    setGradeIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
  }

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const res = await scholarionApi.invoiceRuns({
        academicYearId: yearId,
        termId: termId || undefined,
        gradeLevelIds: gradeIds.length ? gradeIds : undefined,
        dryRun,
      })
      setResult(res)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Invoice run failed', 'danger')
    } finally {
      setRunning(false)
    }
  }

  const activeYear = years.data?.find((y) => y.is_current) ?? years.data?.[0]
  const effectiveYear = yearId || activeYear?.id || ''

  return (
    <Card>
      <CardHeader title="Invoice run" subtitle="Generate invoices for the selected scope." />
      <CardBody className="stack">
        <div className="grid grid-2">
          <Field label="Academic year" required>
            <Select value={effectiveYear} onChange={(e) => setYearId(e.target.value)}>
              {(years.data ?? []).map((y) => (
                <option key={y.id} value={y.id}>{y.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Term">
            <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">All terms</option>
              {(terms.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Grade levels" hint="Leave empty to include all grades.">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(grades.data ?? []).map((g) => (
              <label key={g.id} className="checkbox-row">
                <input type="checkbox" checked={gradeIds.includes(g.id)} onChange={() => toggleGrade(g.id)} />
                <span>{g.name}</span>
              </label>
            ))}
          </div>
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <span>Dry run (preview only — no invoices written)</span>
        </label>
        <div>
          <Button onClick={() => void run()} loading={running}>
            {dryRun ? 'Preview' : 'Run invoice generation'}
          </Button>
        </div>

        {result ? (
          <div className="stack">
            <Alert tone={dryRun ? 'info' : 'success'}>
              {dryRun
                ? `Dry run: ${result.invoices?.length ?? 0} invoices computed${result.totalMinor != null ? `, total ${formatMinor(result.totalMinor, currency)}` : ''}.`
                : `Created ${result.created} invoice(s), skipped ${result.skipped}.`}
            </Alert>
            {result.invoices?.length ? (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Term</th>
                      <th className="num">Subtotal</th>
                      <th className="num">Discount</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{`${inv.student?.first_name ?? ''} ${inv.student?.last_name ?? ''}`}</td>
                        <td>{inv.term?.name ?? '\u2014'}</td>
                        <td className="num">{formatMinor(inv.subtotal_minor, currency)}</td>
                        <td className="num">{formatMinor(inv.discount_minor, currency)}</td>
                        <td className="num">{formatMinor(inv.total_minor, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

const PAGE_SIZE = 20

function Invoices() {
  const { currency, timezone, locale } = useAuth()
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null)

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, status: status || undefined, q: debouncedQ || undefined }),
    [page, status, debouncedQ],
  )
  const invoices = useAsyncData(() => scholarionApi.invoices.list(params), [JSON.stringify(params)])

  return (
    <div className="stack">
      <div className="toolbar">
        <Input placeholder="Search invoice number or student" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { setPage(1); setDebouncedQ(q) }} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setDebouncedQ(q) } }} aria-label="Search invoices" style={{ maxWidth: '20rem' }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="issued">Issued</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Void</option>
        </Select>
      </div>
      <Card>
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
                    <th></th>
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
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="cell-actions">
                        {(inv.status === 'issued' || inv.status === 'partially_paid' || inv.status === 'overdue') ? (
                          <Button variant="outline-danger" size="sm" onClick={() => setVoidTarget(inv)}>Void</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {invoices.data && invoices.data.total > PAGE_SIZE ? (
            <div className="mt-3">
              <Pagination page={invoices.data.page} pageSize={invoices.data.pageSize} total={invoices.data.total} onPage={setPage} />
            </div>
          ) : null}
        </CardBody>
      </Card>
      {voidTarget ? (
        <VoidInvoiceModal
          invoice={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={() => {
            toast('Invoice voided')
            setVoidTarget(null)
            invoices.refetch()
          }}
        />
      ) : null}
    </div>
  )
}

function VoidInvoiceModal({ invoice, onClose, onVoided }: { invoice: Invoice; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open
      title={`Void ${invoice.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} disabled={!reason} onClick={() => {
            setPending(true)
            setError(null)
            scholarionApi.invoices.void(invoice.id, { reason })
              .then(onVoided)
              .catch((err) => setError(err instanceof Error ? err.message : 'Failed'))
              .finally(() => setPending(false))
          }}>Void invoice</Button>
        </>
      }
    >
      <div className="stack">
        {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
        <p className="muted">Voiding writes a reversing ledger entry and cannot be undone.</p>
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function RecordPayment() {
  const { currency } = useAuth()
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [student, setStudent] = useState<{ id: string; first_name: string; last_name: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<Payment | null>(null)

  const search = useAsyncData(
    () => (debouncedQ ? scholarionApi.students.list({ q: debouncedQ, page: 1, pageSize: 10 }) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 10 })),
    [debouncedQ],
  )
  const openInvoices = useAsyncData(
    () => (student ? scholarionApi.invoices.list({ studentId: student.id, pageSize: 100 }) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })),
    [student?.id],
  )

  const amountMinor = amount ? Math.round(Number(amount) * 100) : 0

  const preview = useMemo(() => {
    const open = (openInvoices.data?.items ?? []).filter((i) => i.balance_minor > 0)
    let remaining = amountMinor
    const rows: { invoice: Invoice; allocated: number }[] = []
    for (const inv of open) {
      if (remaining <= 0) break
      const alloc = Math.min(inv.balance_minor, remaining)
      rows.push({ invoice: inv, allocated: alloc })
      remaining -= alloc
    }
    return { rows, remaining }
  }, [openInvoices.data, amountMinor])

  const submit = async () => {
    setPending(true)
    try {
      const res = await scholarionApi.payments.create({
        studentId: student!.id,
        amountMinor,
        method,
        reference: reference || undefined,
        note: note || undefined,
      })
      setReceipt(res)
      openInvoices.refetch()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Payment failed', 'danger')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Record payment" subtitle="Payments are allocated oldest-due-first by default." />
      <CardBody className="stack">
        <Field label="Student" hint="Search by name or admission no.">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setDebouncedQ(q)} placeholder="Type to search…" />
        </Field>
        {debouncedQ && !student ? (
          <div className="stack stack-sm">
            {search.data?.items.map((s) => (
              <button key={s.id} className="row-between" style={{ padding: 'var(--sch-space-2)', border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)', background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => { setStudent(s); setQ(''); setDebouncedQ('') }}>
                <span>{`${s.first_name} ${s.last_name}`}</span>
                <span className="muted">{s.admission_no}</span>
              </button>
            ))}
          </div>
        ) : null}
        {student ? (
          <div className="row">
            <span style={{ fontWeight: '600' }}>{`${student.first_name} ${student.last_name}`}</span>
            <Button variant="ghost" size="sm" onClick={() => setStudent(null)}>Change</Button>
          </div>
        ) : null}

        <div className="grid grid-2">
          <Field label="Amount" required>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Method" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['cash', 'bank_transfer', 'card', 'cheque', 'online'].map((m) => (
                <option key={m} value={m}>{m.replace('_', ' ')}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {student && amountMinor > 0 ? (
          <div className="stack">
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-sm)' }}>Allocation preview (oldest-due-first)</div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="num">Balance</th>
                    <th className="num">Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.invoice.id}>
                      <td>{r.invoice.number}</td>
                      <td className="num">{formatMinor(r.invoice.balance_minor, currency)}</td>
                      <td className="num">{formatMinor(r.allocated, currency)}</td>
                    </tr>
                  ))}
                  {preview.rows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">No open invoices to allocate.</td>
                    </tr>
                  ) : null}
                  {preview.remaining > 0 ? (
                    <tr>
                      <td className="muted">Unapplied credit</td>
                      <td className="num" colSpan={2}>{formatMinor(preview.remaining, currency)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div>
          <Button loading={pending} disabled={!student || amountMinor <= 0} onClick={() => void submit()}>
            Record payment of {formatMinor(amountMinor, currency)}
          </Button>
        </div>
      </CardBody>

      {receipt ? (
        <ReceiptModal payment={receipt} onClose={() => { setReceipt(null); setStudent(null); setAmount('') }} />
      ) : null}
    </Card>
  )
}

function ReceiptModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { currency, school, timezone, locale } = useAuth()
  return (
    <Modal
      open
      title="Payment receipt"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="card-body" style={{ background: 'var(--sch-bg-surface)' }}>
        <h2 style={{ fontSize: 'var(--sch-font-size-lg)' }}>{school?.name}</h2>
        <div className="muted">Receipt {payment.receipt_no}</div>
        <hr className="divider" />
        <div className="stack stack-sm">
          <div className="row-between"><span className="muted">Student</span><span>{`${payment.student?.first_name ?? ''} ${payment.student?.last_name ?? ''}`}</span></div>
          <div className="row-between"><span className="muted">Amount</span><span style={{ fontWeight: '600' }}>{formatMinor(payment.amount_minor, currency)}</span></div>
          <div className="row-between"><span className="muted">Method</span><span>{payment.method.replace('_', ' ')}</span></div>
          <div className="row-between"><span className="muted">Date</span><span>{formatDate(payment.received_on, { timezone, locale })}</span></div>
          {payment.reference ? <div className="row-between"><span className="muted">Reference</span><span>{payment.reference}</span></div> : null}
          <div className="row-between"><span className="muted">Status</span><StatusBadge status={payment.status} /></div>
        </div>
        {payment.allocations?.length ? (
          <>
            <hr className="divider" />
            <div className="muted" style={{ fontSize: 'var(--sch-font-size-sm)' }}>Allocations</div>
            {payment.allocations.map((a) => (
              <div key={a.id} className="row-between">
                <span>{a.invoice?.number ?? a.invoice_id}</span>
                <span>{formatMinor(a.amount_minor, currency)}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
