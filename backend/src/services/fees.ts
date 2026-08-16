import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db/pool.js'
import { sha256Hex, canonicalJson } from '../lib/crypto.js'
import { percentToBasisPoints, applyPercentMinor } from '../lib/money.js'
import { computeLines, totals, discountValue, type DiscountDef, type ComputedLine } from '../engines/fees.js'
import { nextCounter } from '../lib/ids.js'
import { unprocessable, badRequest, notFound } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'

export async function ledgerBalance(db: PoolClient | typeof pool, studentId: string): Promise<bigint> {
  const res = await db.query(
    `SELECT COALESCE(SUM(debit_minor), 0)::bigint AS d, COALESCE(SUM(credit_minor), 0)::bigint AS c
       FROM ledger_entries WHERE student_id = $1`,
    [studentId],
  )
  const r = res.rows[0]
  return BigInt(r.d) - BigInt(r.c)
}

function monthsBetween(start: string, end: string): number {
  const a = new Date(start)
  const b = new Date(end)
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  return Math.max(1, months + 1)
}

interface InvoiceRunOptions {
  schoolId: string
  actorId: string
  academicYearId: string
  termId?: string | null
  gradeLevelIds?: string[] | null
  dryRun: boolean
}

interface ComputedInvoice {
  studentId: string
  termId: string
  structureId: string
  lines: ComputedLine[]
  subtotalMinor: bigint
  discountMinor: bigint
  totalMinor: bigint
  idempotencyKey: string
}

export interface InvoiceRunResult {
  created: number
  skipped: number
  dryRun: boolean
  invoices: ComputedInvoice[]
  totalMinor: bigint
}

function criteriaHash(opts: InvoiceRunOptions): string {
  return sha256Hex(
    canonicalJson({
      academicYearId: opts.academicYearId,
      termId: opts.termId ?? null,
      gradeLevelIds: opts.gradeLevelIds ?? null,
    }),
  )
}

export async function runInvoiceGeneration(opts: InvoiceRunOptions): Promise<InvoiceRunResult> {
  const { schoolId, actorId, academicYearId } = opts
  const chash = criteriaHash(opts)

  const termsRes = await pool.query(
    `SELECT id, sequence, starts_on, ends_on FROM terms
      WHERE academic_year_id = $1
        AND ($2::uuid IS NULL OR id = $2::uuid)
        AND status IN ('active','locked')
      ORDER BY sequence`,
    [academicYearId, opts.termId ?? null],
  )
  const terms = termsRes.rows

  let students: { student_id: string }[]
  if (opts.gradeLevelIds && opts.gradeLevelIds.length > 0) {
    const s = await pool.query(
      `SELECT e.student_id
         FROM enrollments e
         JOIN sections sec ON sec.id = e.section_id
        WHERE e.academic_year_id = $1 AND e.left_on IS NULL
          AND sec.grade_level_id = ANY($2)
        ORDER BY e.student_id`,
      [academicYearId, opts.gradeLevelIds],
    )
    students = s.rows
  } else {
    const s = await pool.query(
      `SELECT student_id FROM enrollments
        WHERE academic_year_id = $1 AND left_on IS NULL
        ORDER BY student_id`,
      [academicYearId],
    )
    students = s.rows
  }

  const computed: ComputedInvoice[] = []
  for (const term of terms) {
    const termId = term.id as string
    const isFirstTerm = Number(term.sequence) === 1
    const months = monthsBetween(term.starts_on as string, term.ends_on as string)

    for (const stu of students) {
      const studentId = stu.student_id as string

      const assignmentRes = await pool.query(
        `SELECT id, structure_id FROM fee_assignments
          WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, academicYearId],
      )
      if (assignmentRes.rowCount === 0) continue

      const discounts: DiscountDef[] = await loadApprovedDiscounts(studentId, academicYearId)

      for (const assignment of assignmentRes.rows) {
        const structureId = assignment.structure_id as string
        const itemsRes = await pool.query(
          `SELECT id, name, category, amount_minor, frequency
             FROM fee_items WHERE structure_id = $1`,
          [structureId],
        )

        const lineInputs = itemsRes.rows
          .filter((it) => {
            if (it.frequency === 'once') return isFirstTerm
            return true
          })
          .map((it) => ({
            category: it.category as string,
            description: it.name as string,
            unitAmountMinor: BigInt(it.amount_minor),
            quantity: it.frequency === 'monthly' ? months : 1,
          }))

        if (lineInputs.length === 0) continue

        const lines = computeLines(lineInputs, discounts)
        const t = totals(lines)
        if (t.totalMinor === 0n) continue

        const idempotencyKey = sha256Hex(`${studentId}|${termId}|${structureId}|${chash}`)

        computed.push({
          studentId,
          termId,
          structureId,
          lines,
          subtotalMinor: t.subtotalMinor,
          discountMinor: t.discountMinor,
          totalMinor: t.totalMinor,
          idempotencyKey,
        })
      }
    }
  }

  const totalMinor = computed.reduce((acc, c) => acc + c.totalMinor, 0n)

  if (opts.dryRun) {
    return { created: 0, skipped: 0, dryRun: true, invoices: computed, totalMinor }
  }

  let created = 0
  let skipped = 0

  await withTransaction(async (client) => {
    for (const c of computed) {
      const existing = await client.query(
        `SELECT 1 FROM invoices WHERE idempotency_key = $1`,
        [c.idempotencyKey],
      )
      if (existing.rowCount) {
        skipped++
        continue
      }

      const year = new Date().getFullYear()
      const seq = await nextCounter(client, schoolId, 'invoice')
      const number = `INV-${year}-${String(seq).padStart(6, '0')}`

      const invoiceRes = await client.query(
        `INSERT INTO invoices
          (school_id, student_id, academic_year_id, term_id, number, issue_date, due_date,
           subtotal_minor, discount_minor, late_fee_minor, total_minor, paid_minor, balance_minor,
           status, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE, CURRENT_DATE + 30,
                 $6,$7,0,$8,0,$8,'issued',$9)
         RETURNING id`,
        [
          schoolId,
          c.studentId,
          academicYearId,
          c.termId,
          number,
          c.subtotalMinor.toString(),
          c.discountMinor.toString(),
          c.totalMinor.toString(),
          c.idempotencyKey,
        ],
      )
      const invoiceId = invoiceRes.rows[0].id as string

      for (const line of c.lines) {
        await client.query(
          `INSERT INTO invoice_lines
            (invoice_id, description, quantity, unit_amount_minor, discount_minor, line_total_minor)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            invoiceId,
            line.description,
            line.quantity,
            line.unitAmountMinor.toString(),
            line.discountMinor.toString(),
            line.lineTotalMinor.toString(),
          ],
        )
      }

      const balance = await ledgerBalance(client, c.studentId)
      await client.query(
        `INSERT INTO ledger_entries
          (school_id, student_id, entry_date, kind, reference_type, reference_id,
           debit_minor, credit_minor, balance_after_minor, memo)
         VALUES ($1,$2,CURRENT_DATE,'invoice','invoice',$3,$4,0,$5,'Invoice issued')`,
        [schoolId, c.studentId, invoiceId, c.totalMinor.toString(), (balance + c.totalMinor).toString()],
      )
      created++
    }

    await client.query(
      `INSERT INTO invoice_batches (academic_year_id, term_id, criteria_json, status, invoice_count, total_minor, run_by)
       VALUES ($1,$2,$3,'completed',$4,$5,$6)`,
      [
        academicYearId,
        opts.termId ?? null,
        JSON.stringify({ academicYearId, termId: opts.termId, gradeLevelIds: opts.gradeLevelIds }),
        created,
        totalMinor.toString(),
        actorId,
      ],
    )
  })

  return { created, skipped, dryRun: false, invoices: computed, totalMinor }
}

async function loadApprovedDiscounts(studentId: string, academicYearId: string): Promise<DiscountDef[]> {
  const res = await pool.query(
    `SELECT d.kind, d.value, d.applies_to_category
       FROM student_discounts sd
       JOIN discounts d ON d.id = sd.discount_id
      WHERE sd.student_id = $1 AND sd.academic_year_id = $2 AND sd.status = 'approved'
        AND (sd.valid_from IS NULL OR sd.valid_from <= CURRENT_DATE)
        AND (sd.valid_to IS NULL OR sd.valid_to >= CURRENT_DATE)`,
    [studentId, academicYearId],
  )
  return res.rows.map((r) => {
    const v = discountValue({ kind: r.kind as 'percent' | 'fixed', value: r.value as string | number })
    return {
      kind: r.kind as 'percent' | 'fixed',
      valueBp: v.valueBp,
      valueMinor: v.valueMinor,
      appliesToCategory: (r.applies_to_category as string) ?? null,
    }
  })
}

export interface PaymentOptions {
  schoolId: string
  actorId: string
  studentId: string
  amountMinor: bigint
  method: string
  reference?: string | null
  receivedOn: string
  note?: string | null
  allocations?: { invoiceId: string; amountMinor: bigint }[] | null
}

export interface PaymentResult {
  id: string
  receiptNo: string
  amountMinor: bigint
  allocatedMinor: bigint
  unappliedMinor: bigint
  allocations: { invoiceId: string; amountMinor: bigint; invoiceStatus: string }[]
}

export async function recordPayment(opts: PaymentOptions): Promise<PaymentResult> {
  if (opts.amountMinor <= 0n) throw badRequest('Payment amount must be positive')

  return withTransaction(async (client) => {
    const seq = await nextCounter(client, opts.schoolId, 'receipt')
    const receiptNo = `RCT-${String(seq).padStart(6, '0')}`

    const paymentRes = await client.query(
      `INSERT INTO payments
        (school_id, student_id, receipt_no, amount_minor, method, reference, received_on, received_by, status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'recorded',$9)
       RETURNING id`,
      [
        opts.schoolId,
        opts.studentId,
        receiptNo,
        opts.amountMinor.toString(),
        opts.method,
        opts.reference ?? null,
        opts.receivedOn,
        opts.actorId,
        opts.note ?? null,
      ],
    )
    const paymentId = paymentRes.rows[0].id as string

    let allocationDefs: { invoiceId: string; amountMinor: bigint }[]

    if (opts.allocations && opts.allocations.length > 0) {
      const sum = opts.allocations.reduce((acc, a) => acc + a.amountMinor, 0n)
      if (sum > opts.amountMinor) {
        throw unprocessable('Unprocessable', 'Allocations exceed the payment amount', {
          allocationSum: sum.toString(),
          amountMinor: opts.amountMinor.toString(),
        })
      }
      allocationDefs = opts.allocations.filter((a) => a.amountMinor > 0n)
    } else {
      const open = await client.query(
        `SELECT id, balance_minor FROM invoices
          WHERE student_id = $1 AND balance_minor > 0 AND status IN ('issued','partially_paid','overdue')
          ORDER BY due_date ASC, created_at ASC, number ASC
          FOR UPDATE`,
        [opts.studentId],
      )
      let remaining = opts.amountMinor
      allocationDefs = []
      for (const inv of open.rows) {
        if (remaining <= 0n) break
        const balance = BigInt(inv.balance_minor)
        const alloc = balance < remaining ? balance : remaining
        allocationDefs.push({ invoiceId: inv.id as string, amountMinor: alloc })
        remaining -= alloc
      }
    }

    const allocated = allocationDefs.reduce((acc, a) => acc + a.amountMinor, 0n)
    const unapplied = opts.amountMinor - allocated

    const results: { invoiceId: string; amountMinor: bigint; invoiceStatus: string }[] = []
    for (const a of allocationDefs) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_minor)
         VALUES ($1,$2,$3)`,
        [paymentId, a.invoiceId, a.amountMinor.toString()],
      )
      const upd = await client.query(
        `UPDATE invoices
           SET paid_minor = paid_minor + $1, balance_minor = balance_minor - $1,
               status = CASE WHEN balance_minor - $1 <= 0 THEN 'paid' ELSE 'partially_paid' END
         WHERE id = $2
         RETURNING status`,
        [a.amountMinor.toString(), a.invoiceId],
      )
      results.push({ invoiceId: a.invoiceId, amountMinor: a.amountMinor, invoiceStatus: upd.rows[0].status as string })
    }

    const balance = await ledgerBalance(client, opts.studentId)
    await client.query(
      `INSERT INTO ledger_entries
        (school_id, student_id, entry_date, kind, reference_type, reference_id,
         debit_minor, credit_minor, balance_after_minor, memo)
       VALUES ($1,$2,$3,'payment','payment',$4,0,$5,$6,'Payment received')`,
      [
        opts.schoolId,
        opts.studentId,
        opts.receivedOn,
        paymentId,
        opts.amountMinor.toString(),
        (balance - opts.amountMinor).toString(),
      ],
    )

    return {
      id: paymentId,
      receiptNo,
      amountMinor: opts.amountMinor,
      allocatedMinor: allocated,
      unappliedMinor: unapplied,
      allocations: results,
    }
  })
}

export interface LateFeePolicy {
  graceDays: number
  kind: 'percent' | 'fixed'
  value: string | number
  capMinor: bigint | null
  chargeOncePerPeriod: boolean
}

export async function getLateFeePolicy(schoolId: string): Promise<LateFeePolicy | null> {
  const res = await pool.query(`SELECT settings_json FROM schools WHERE id = $1`, [schoolId])
  const settings = (res.rows[0]?.settings_json ?? {}) as { lateFeePolicy?: Partial<LateFeePolicy> }
  const p = settings.lateFeePolicy
  if (!p || !p.kind) return null
  return {
    graceDays: p.graceDays ?? 0,
    kind: p.kind,
    value: p.value ?? 0,
    capMinor: p.capMinor != null ? BigInt(p.capMinor) : null,
    chargeOncePerPeriod: p.chargeOncePerPeriod ?? true,
  }
}

export async function applyLateFees(schoolId: string, actorId?: string): Promise<number> {
  const policy = await getLateFeePolicy(schoolId)
  if (!policy) return 0

  const eligible = await pool.query(
    `SELECT id, student_id, balance_minor
       FROM invoices
      WHERE school_id = $1
        AND status IN ('issued','partially_paid')
        AND due_date < CURRENT_DATE - $2::int
        AND balance_minor > 0
      ORDER BY due_date`,
    [schoolId, policy.graceDays],
  )

  let charged = 0
  for (const inv of eligible.rows) {
    const invoiceId = inv.id as string
    const studentId = inv.student_id as string
    const balance = BigInt(inv.balance_minor)

    if (policy.chargeOncePerPeriod) {
      const already = await pool.query(
        `SELECT 1 FROM ledger_entries
          WHERE kind = 'late_fee' AND reference_type = 'invoice' AND reference_id = $1
            AND entry_date = CURRENT_DATE`,
        [invoiceId],
      )
      if (already.rowCount) continue
    }

    let fee: bigint
    if (policy.kind === 'percent') {
      fee = applyPercentMinor(balance, percentToBasisPoints(policy.value))
    } else {
      fee = BigInt(Math.round(Number(percentToBasisPoints(policy.value))))
    }
    if (policy.capMinor != null && fee > policy.capMinor) fee = policy.capMinor
    if (fee <= 0n) fee = 0n

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE invoices
           SET late_fee_minor = late_fee_minor + $1,
               total_minor = total_minor + $1,
               balance_minor = balance_minor + $1,
               status = 'overdue'
         WHERE id = $2`,
        [fee.toString(), invoiceId],
      )
      if (fee > 0n) {
        await client.query(
          `INSERT INTO invoice_lines
            (invoice_id, description, quantity, unit_amount_minor, discount_minor, line_total_minor)
           VALUES ($1,'Late fee',1,$2,0,$2)`,
          [invoiceId, fee.toString()],
        )
      }
      const bal = await ledgerBalance(client, studentId)
      await client.query(
        `INSERT INTO ledger_entries
          (school_id, student_id, entry_date, kind, reference_type, reference_id,
           debit_minor, credit_minor, balance_after_minor, memo)
         VALUES ($1,$2,CURRENT_DATE,'late_fee','invoice',$3,$4,0,$5,'Late fee applied')`,
        [schoolId, studentId, invoiceId, fee.toString(), (bal + fee).toString()],
      )
      charged++
    })
  }

  if (actorId) await writeAudit(pool, { schoolId, actorId, action: 'fees.apply_late_fees', metadata: { charged } })
  return charged
}

export async function voidInvoice(
  schoolId: string,
  actorId: string,
  invoiceId: string,
  reason: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const res = await client.query(
      `SELECT id, student_id, balance_minor, status FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [invoiceId, schoolId],
    )
    const inv = res.rows[0]
    if (!inv) throw notFound('Invoice not found')
    if (inv.status === 'void') throw badRequest('Invoice already void')
    if (inv.status === 'paid') throw unprocessable('InvalidTransition', 'Cannot void a paid invoice', {
      from: inv.status,
      to: 'void',
      allowed: ['issued', 'partially_paid', 'overdue', 'draft'],
    })

    await client.query(
      `UPDATE invoices SET status = 'void', voided_reason = $1, balance_minor = 0 WHERE id = $2`,
      [reason, invoiceId],
    )
    const bal = await ledgerBalance(client, inv.student_id as string)
    await client.query(
      `INSERT INTO ledger_entries
        (school_id, student_id, entry_date, kind, reference_type, reference_id,
         debit_minor, credit_minor, balance_after_minor, memo)
       VALUES ($1,$2,CURRENT_DATE,'void','invoice',$3,0,$4,$5,'Invoice voided')`,
      [schoolId, inv.student_id, invoiceId, (inv.balance_minor as unknown as bigint).toString(), bal.toString()],
    )
  })
  await writeAudit(pool, { schoolId, actorId, action: 'invoice.void', entityType: 'invoice', entityId: invoiceId, metadata: { reason } })
}

export interface FeesSummaryRow {
  billed_minor: number
  collected_minor: number
  outstanding_minor: number
  overdue_minor: number
  aging_buckets: { bucket: string; amount_minor: number }[]
  total_students: number
}

export async function getFeesSummary(schoolId: string, academicYearId: string): Promise<FeesSummaryRow> {
  const totalsRes = await pool.query(
    `SELECT
       COALESCE(SUM(total_minor), 0)::bigint  AS billed,
       COALESCE(SUM(paid_minor), 0)::bigint   AS collected,
       COALESCE(SUM(balance_minor), 0)::bigint AS outstanding,
       COALESCE(SUM(balance_minor) FILTER (WHERE status = 'overdue'), 0)::bigint AS overdue
     FROM invoices
     WHERE school_id = $1 AND academic_year_id = $2 AND status <> 'void' AND status <> 'draft'`,
    [schoolId, academicYearId],
  )
  const t = totalsRes.rows[0]

  const agingRes = await pool.query(
    `SELECT
       CASE
         WHEN (CURRENT_DATE - due_date) <= 30 THEN '0-30'
         WHEN (CURRENT_DATE - due_date) <= 60 THEN '31-60'
         WHEN (CURRENT_DATE - due_date) <= 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COALESCE(SUM(balance_minor), 0)::bigint AS amount_minor
     FROM invoices
     WHERE school_id = $1 AND academic_year_id = $2 AND balance_minor > 0
       AND status IN ('issued','partially_paid','overdue')
     GROUP BY bucket
     ORDER BY bucket`,
    [schoolId, academicYearId],
  )

  const studentsRes = await pool.query(
    `SELECT count(DISTINCT student_id)::int AS total_students
       FROM invoices WHERE school_id = $1 AND academic_year_id = $2 AND status <> 'void'`,
    [schoolId, academicYearId],
  )

  return {
    billed_minor: Number(t.billed),
    collected_minor: Number(t.collected),
    outstanding_minor: Number(t.outstanding),
    overdue_minor: Number(t.overdue),
    aging_buckets: agingRes.rows.map((r) => ({ bucket: r.bucket as string, amount_minor: Number(r.amount_minor) })),
    total_students: Number(studentsRes.rows[0]?.total_students ?? 0),
  }
}
