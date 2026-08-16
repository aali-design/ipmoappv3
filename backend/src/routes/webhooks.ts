import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { notFound } from '../lib/errors.js'
import { newToken } from '../lib/crypto.js'

export const webhooksRouter = Router()

const webhookSchema = z.object({
  url: z.string().url(),
  event: z.enum(['attendance.absence_alert', 'report_card.published', 'invoice.issued', 'payment.recorded']),
})

webhooksRouter.get(
  '/webhooks',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, url, event, secret, is_active, created_at FROM webhooks WHERE school_id = $1 ORDER BY created_at DESC`,
      [req.auth!.school_id],
    )
    res.json({ items: rows, total: rows.length })
  }),
)

webhooksRouter.post(
  '/webhooks',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = webhookSchema.parse(req.body)
    const secret = newToken()
    const { rows } = await pool.query(
      `INSERT INTO webhooks (school_id, url, event, secret) VALUES ($1,$2,$3,$4)
       RETURNING id, url, event, secret, is_active, created_at`,
      [req.auth!.school_id, body.url, body.event, secret],
    )
    res.status(201).json(rows[0])
  }),
)

webhooksRouter.delete(
  '/webhooks/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT id FROM webhooks WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.auth!.school_id,
    ])
    if (rows.length === 0) throw notFound('Webhook not found')
    await pool.query(`DELETE FROM webhooks WHERE id = $1`, [req.params.id])
    res.status(204).send()
  }),
)
