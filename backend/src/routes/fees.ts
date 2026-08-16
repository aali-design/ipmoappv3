import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler, paginated, parsePagination } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { forbidden, notFound, badRequest } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'
import { dispatchWebhook } from '../engines/webhooks.js'
import {
  runInvoiceGeneration,
  recordPayment,
  applyLateFees,
  voidInvoice,
  getFeesSummary,
} from '../services/fees.js'

export const feesRouter = Router()

/** Guardian/student may only touch their own children/self (spec §1). */
function assertStudentInScope(schoolId: string, auth: { role: string; student_ids?: string[]; student_id?: string }, studentId: string): void {
  if (auth.role === 'guardian') {
    if (!auth.student_ids?.includes(studentId)) throw notFound('Student not found')
  } else if (auth.role === 'student') {
    if (auth.student_id !== studentId) throw notFound('Student not found')
  }
  void schoolId
}

const feeStructureSchema = z.object({
  academic_year_id: z.string().uuid(),
  grade_level_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  is_active: z.boolean().optional(),
})

feesRouter.get(
  '/fee-structures',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const yearId = req.query.academicYearId as string | undefined
    const { rows } = await pool.query(
      `SELECT fs.*, ay.name AS year_name, gl.name AS grade_name
         FROM fee_structures fs
         JOIN academic_years ay ON ay.id = fs.academic_year_id
         LEFT JOIN grade_levels gl ON gl.id = fs.grade_level_id
        WHERE ay.school_id = $1 AND ($2::uuid IS NULL OR fs.academic_year_id = $2::uuid)
        ORDER BY fs.name`,
      [req.auth!.school_id, yearId ?? null],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

feesRouter.post(
  '/fee-structures',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = feeStructureSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO fee_structures (academic_year_id, grade_level_id, name, is_active)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.academic_year_id, body.grade_level_id ?? null, body.name, body.is_active ?? true],
    )
    res.status(201).json(rows[0])
  }),
)

const feeItemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['tuition', 'transport', 'meals', 'activity', 'exam', 'uniform', 'other']),
  amount_minor: z.number().int().nonnegative(),
  frequency: z.enum(['once', 'per_term', 'monthly']).optional(),
  is_optional: z.boolean().optional(),
})

feesRouter.post(
  '/fee-structures/:id/items',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = feeItemSchema.parse(req.body)
    const structure = await pool.query(
      `SELECT 1 FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id
        WHERE fs.id = $1 AND ay.school_id = $2`,
      [req.params.id, req.auth!.school_id],
    )
    if (structure.rowCount === 0) throw notFound('Fee structure not found')
    const { rows } = await pool.query(
      `INSERT INTO fee_items (structure_id, name, category, amount_minor, frequency, is_optional)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, body.name, body.category, body.amount_minor, body.frequency ?? 'once', body.is_optional ?? false],
    )
    res.status(201).json(rows[0])
  }),
)

const feeAssignmentSchema = z.object({
  student_id: z.string().uuid(),
  structure_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
})

feesRouter.post(
  '/fee-assignments',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const body = feeAssignmentSchema.parse(req.body)
    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [
      body.student_id,
      req.auth!.school_id,
    ])
    if (student.rowCount === 0) throw notFound('Student not found')
    const { rows } = await pool.query(
      `INSERT INTO fee_assignments (student_id, structure_id, academic_year_id)
       VALUES ($1,$2,$3) RETURNING *`,
      [body.student_id, body.structure_id, body.academic_year_id],
    )
    res.status(201).json(rows[0])
  }),
)

const discountSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().nonnegative(),
  applies_to_category: z.enum(['tuition', 'transport', 'meals', 'activity', 'exam', 'uniform', 'other']).nullable().optional(),
  requires_approval: z.boolean().optional(),
})

feesRouter.get(
  '/discounts',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM discounts WHERE school_id = $1 ORDER BY name`, [req.auth!.school_id])
    res.json({ items: rows, total: rows.length })
  }),
)

feesRouter.post(
  '/discounts',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = discountSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO discounts (school_id, name, kind, value, applies_to_category, requires_approval)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.auth!.school_id, body.name, body.kind, body.value, body.applies_to_category ?? null, body.requires_approval ?? false],
    )
    res.status(201).json(rows[0])
  }),
)

const studentDiscountSchema = z.object({
  student_id: z.string().uuid(),
  discount_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

feesRouter.post(
  '/student-discounts',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const body = studentDiscountSchema.parse(req.body)
    const { rows } = await pool.query(
      `INSERT INTO student_discounts (student_id, discount_id, academic_year_id, status, valid_from, valid_to)
       VALUES ($1,$2,$3,'pending',$4,$5) RETURNING *`,
      [body.student_id, body.discount_id, body.academic_year_id, body.valid_from ?? null, body.valid_to ?? null],
    )
    res.status(201).json(rows[0])
  }),
)

const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']) })

feesRouter.post(
  '/student-discounts/:id/decision',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = decisionSchema.parse(req.body)
    const existing = await pool.query(
      `SELECT sd.*, s.school_id FROM student_discounts sd JOIN students s ON s.id = sd.student_id WHERE sd.id = $1`,
      [req.params.id],
    )
    if (existing.rowCount === 0) throw notFound('Student discount not found')
    if (existing.rows[0].school_id !== req.auth!.school_id) throw notFound('Student discount not found')

    await pool.query(
      `UPDATE student_discounts SET status = $1, approved_by = $2 WHERE id = $3`,
      [body.decision, body.decision === 'approved' ? req.auth!.id : null, req.params.id],
    )
    res.json({ ok: true })
  }),
)

const invoiceRunSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().nullable().optional(),
  gradeLevelIds: z.array(z.string().uuid()).optional(),
  dryRun: z.boolean().optional(),
})

feesRouter.post(
  '/fees/invoice-runs',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const body = invoiceRunSchema.parse(req.body)
    const result = await runInvoiceGeneration({
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      academicYearId: body.academicYearId,
      termId: body.termId ?? null,
      gradeLevelIds: body.gradeLevelIds ?? null,
      dryRun: body.dryRun ?? false,
    })
    await writeAudit(pool, {
      schoolId: req.auth!.school_id,
      actorId: req.auth!.id,
      action: 'fees.invoice_run',
      metadata: { dryRun: body.dryRun ?? false, created: result.created, skipped: result.skipped },
    })
    if (!result.dryRun && result.created > 0) {
      dispatchWebhook('invoice.issued', req.auth!.school_id, { created: result.created })
    }
    res.status(result.dryRun ? 200 : 201).json({
      created: result.created,
      skipped: result.skipped,
      dryRun: result.dryRun,
      totalMinor: result.totalMinor.toString(),
      invoices: result.invoices.map((c) => ({
        studentId: c.studentId,
        termId: c.termId,
        subtotalMinor: c.subtotalMinor.toString(),
        discountMinor: c.discountMinor.toString(),
        totalMinor: c.totalMinor.toString(),
        lines: c.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit_amount_minor: l.unitAmountMinor.toString(),
          discount_minor: l.discountMinor.toString(),
          line_total_minor: l.lineTotalMinor.toString(),
        })),
      })),
    })
  }),
)

feesRouter.post(
  '/fees/late-fees',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const charged = await applyLateFees(req.auth!.school_id, req.auth!.id)
    res.json({ charged })
  }),
)

feesRouter.get(
  '/invoices',
  authenticate,
  requireRole('admin', 'accountant', 'student', 'guardian'),
  asyncHandler(async (req, res) => {
    const pag = parsePagination(req.query)
    const status = req.query.status as string | undefined
    const overdue = req.query.overdue as string | undefined
    const q = req.query.q as string | undefined

    const filters: string[] = ['inv.school_id = $1']
    const params: unknown[] = [req.auth!.school_id]

    if (req.auth!.role === 'guardian') {
      params.push(req.auth!.student_ids ?? [])
      filters.push(`inv.student_id = ANY($${params.length}::uuid[])`)
    } else if (req.auth!.role === 'student') {
      params.push(req.auth!.student_id)
      filters.push(`inv.student_id = $${params.length}`)
    }
    if (status) {
      params.push(status)
      filters.push(`inv.status = $${params.length}`)
    }
    if (overdue === 'true') {
      filters.push(`inv.status = 'overdue'`)
    }
    if (q) {
      params.push(`%${q}%`)
      filters.push(`(inv.number ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`)
    }

    const where = filters.join(' AND ')
    const countRes = await pool.query(`SELECT count(*)::int AS total FROM invoices inv JOIN students s ON s.id = inv.student_id WHERE ${where}`, params)
    const total = Number(countRes.rows[0].total)

    const listRes = await pool.query(
      `SELECT inv.*, s.first_name, s.last_name, s.admission_no
         FROM invoices inv JOIN students s ON s.id = inv.student_id
        WHERE ${where}
        ORDER BY inv.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pag.limit, pag.offset],
    )

    const items = listRes.rows.map((r) => ({
      ...r,
      student: { id: r.student_id, first_name: r.first_name, last_name: r.last_name, admission_no: r.admission_no },
    }))
    res.json(paginated(items, total, pag.page, pag.pageSize))
  }),
)

feesRouter.get(
  '/invoices/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id])
    if (rows.length === 0) throw notFound('Invoice not found')
    const inv = rows[0]
    assertStudentInScope(inv.school_id, req.auth!, inv.student_id)

    const lines = await pool.query(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id`, [req.params.id])
    res.json({ ...inv, lines: lines.rows })
  }),
)

const voidSchema = z.object({ reason: z.string().min(1) })

feesRouter.post(
  '/invoices/:id/void',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = voidSchema.parse(req.body)
    await voidInvoice(req.auth!.school_id, req.auth!.id, req.params.id, body.reason)
    res.json({ ok: true })
  }),
)

const paymentSchema = z.object({
  student_id: z.string().uuid(),
  amount_minor: z.number().int().positive(),
  method: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'online']).optional(),
  reference: z.string().nullable().optional(),
  received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().nullable().optional(),
  allocations: z.array(z.object({ invoice_id: z.string().uuid(), amount_minor: z.number().int().positive() })).optional(),
  invoice_ids: z.array(z.string().uuid()).optional(),
})

feesRouter.post(
  '/payments',
  authenticate,
  requireRole('admin', 'accountant', 'guardian'),
  asyncHandler(async (req, res) => {
    const body = paymentSchema.parse(req.body)
    const schoolId = req.auth!.school_id

    const student = await pool.query(`SELECT id FROM students WHERE id = $1 AND school_id = $2`, [
      body.student_id,
      schoolId,
    ])
    if (student.rowCount === 0) throw notFound('Student not found')

    if (req.auth!.role === 'guardian' && !req.auth!.student_ids?.includes(body.student_id)) {
      throw forbidden('Guardian may only pay for their own children')
    }

    let allocations = body.allocations?.map((a) => ({ invoiceId: a.invoice_id, amountMinor: BigInt(a.amount_minor) })) ?? null
    if (!allocations && body.invoice_ids && body.invoice_ids.length > 0) {
      const open = await pool.query(
        `SELECT id, balance_minor FROM invoices
          WHERE id = ANY($1) AND student_id = $2 AND balance_minor > 0
          ORDER BY due_date ASC, number ASC`,
        [body.invoice_ids, body.student_id],
      )
      let remaining = BigInt(body.amount_minor)
      allocations = []
      for (const inv of open.rows) {
        if (remaining <= 0n) break
        const balance = BigInt(inv.balance_minor)
        const alloc = balance < remaining ? balance : remaining
        allocations.push({ invoiceId: inv.id as string, amountMinor: alloc })
        remaining -= alloc
      }
    }

    const result = await recordPayment({
      schoolId,
      actorId: req.auth!.id,
      studentId: body.student_id,
      amountMinor: BigInt(body.amount_minor),
      method: body.method ?? 'cash',
      reference: body.reference ?? null,
      receivedOn: body.received_on ?? new Date().toISOString().slice(0, 10),
      note: body.note ?? null,
      allocations,
    })

    await writeAudit(pool, {
      schoolId,
      actorId: req.auth!.id,
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: result.id,
      metadata: { amount_minor: result.amountMinor.toString() },
    })
    dispatchWebhook('payment.recorded', schoolId, { payment_id: result.id, receipt_no: result.receiptNo })

    res.status(201).json({
      id: result.id,
      receipt_no: result.receiptNo,
      amount_minor: Number(result.amountMinor),
      allocated_minor: Number(result.allocatedMinor),
      unapplied_minor: Number(result.unappliedMinor),
      allocations: result.allocations.map((a) => ({
        invoice_id: a.invoiceId,
        amount_minor: Number(a.amountMinor),
        invoice_status: a.invoiceStatus,
      })),
    })
  }),
)

feesRouter.get(
  '/payments/:id/receipt',
  authenticate,
  requireRole('admin', 'accountant', 'guardian'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*, s.first_name, s.last_name, s.admission_no FROM payments p JOIN students s ON s.id = p.student_id WHERE p.id = $1`,
      [req.params.id],
    )
    if (rows.length === 0) throw notFound('Payment not found')
    const payment = rows[0]
    if (req.auth!.role === 'guardian' && !req.auth!.student_ids?.includes(payment.student_id)) throw notFound('Payment not found')

    const allocations = await pool.query(
      `SELECT pa.*, inv.number, inv.due_date FROM payment_allocations pa JOIN invoices inv ON inv.id = pa.invoice_id WHERE pa.payment_id = $1`,
      [req.params.id],
    )
    res.json({ ...payment, allocations: allocations.rows })
  }),
)

feesRouter.get(
  '/students/:id/ledger',
  authenticate,
  requireRole('admin', 'accountant', 'student', 'guardian'),
  asyncHandler(async (req, res) => {
    const studentId = req.params.id
    assertStudentInScope(req.auth!.school_id, req.auth!, studentId)

    const { rows } = await pool.query(
      `SELECT * FROM ledger_entries WHERE student_id = $1 ORDER BY entry_date, id`,
      [studentId],
    )
    const balanceRes = await pool.query(
      `SELECT
         COALESCE(SUM(debit_minor),0)::bigint AS total_debit,
         COALESCE(SUM(credit_minor),0)::bigint AS total_credit
       FROM ledger_entries WHERE student_id = $1`,
      [studentId],
    )
    const outstandingRes = await pool.query(
      `SELECT COALESCE(SUM(balance_minor),0)::bigint AS outstanding
         FROM invoices WHERE student_id = $1 AND status <> 'void' AND status <> 'draft'`,
      [studentId],
    )

    const totalDebit = BigInt(balanceRes.rows[0].total_debit)
    const totalCredit = BigInt(balanceRes.rows[0].total_credit)
    const outstanding = BigInt(outstandingRes.rows[0].outstanding)

    res.json({
      items: rows,
      total_debit_minor: Number(totalDebit),
      total_credit_minor: Number(totalCredit),
      outstanding_minor: Number(outstanding),
      reconciled: totalDebit - totalCredit === outstanding,
    })
  }),
)

feesRouter.get(
  '/fees/summary',
  authenticate,
  requireRole('admin', 'accountant'),
  asyncHandler(async (req, res) => {
    const academicYearId = req.query.academicYearId as string
    if (!academicYearId) throw badRequest('academicYearId is required')
    const summary = await getFeesSummary(req.auth!.school_id, academicYearId)
    res.json(summary)
  }),
)
