import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { asyncHandler } from '../lib/http.js'
import { hashPassword, verifyPassword, newToken } from '../lib/crypto.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js'
import { buildAuthUser } from '../services/auth.js'
import { authenticate } from '../middleware/auth.js'
import { unauthorized, badRequest } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body)
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [body.email])
    const user = rows[0]
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw unauthorized('Invalid email or password')
    }
    if (!user.is_active) throw unauthorized('Account is deactivated')

    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id])

    const authUser = await buildAuthUser(user.id)
    if (!authUser) throw unauthorized('Account unavailable')

    const accessToken = signAccessToken({
      sub: user.id,
      school_id: user.school_id,
      role: user.role,
    })
    const { token: refreshToken, jti } = signRefreshToken(user.id)
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, jti, expires_at) VALUES ($1, $2, $3)`,
      [user.id, jti, expiresAt],
    )

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        school_id: user.school_id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone ?? null,
        is_active: user.is_active,
        last_login_at: user.last_login_at,
      },
      scope: authUser.student_ids && authUser.student_ids.length > 0 ? { studentIds: authUser.student_ids } : {},
    })
  }),
)

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body)
    let claims
    try {
      claims = verifyRefreshToken(body.refreshToken)
    } catch {
      throw unauthorized('Invalid or expired refresh token')
    }
    const { rows } = await pool.query(
      `SELECT id FROM refresh_tokens WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [claims.jti],
    )
    if (rows.length === 0) throw unauthorized('Refresh token revoked')

    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE jti = $1`, [claims.jti])

    const userRes = await pool.query(`SELECT id, is_active FROM users WHERE id = $1`, [claims.sub])
    const user = userRes.rows[0]
    if (!user || !user.is_active) throw unauthorized('Account unavailable')

    const authUser = await buildAuthUser(user.id)
    if (!authUser) throw unauthorized('Account unavailable')

    const accessToken = signAccessToken({ sub: user.id, school_id: authUser.school_id, role: authUser.role })
    const { token: refreshToken, jti } = signRefreshToken(user.id)
    await pool.query(`INSERT INTO refresh_tokens (user_id, jti, expires_at) VALUES ($1, $2, $3)`, [
      user.id,
      jti,
      new Date(Date.now() + 7 * 24 * 3600 * 1000),
    ])

    res.json({ accessToken, refreshToken })
  }),
)

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.safeParse(req.body)
    if (body.success) {
      try {
        const claims = verifyRefreshToken(body.data.refreshToken)
        await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE jti = $1`, [claims.jti])
      } catch {
        /* already invalid */
      }
    }
    res.status(204).send()
  }),
)

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      id: req.auth!.id,
      school_id: req.auth!.school_id,
      email: req.auth!.email,
      full_name: req.auth!.full_name,
      role: req.auth!.role,
      is_active: req.auth!.is_active,
      last_login_at: req.auth!.last_login_at ?? null,
      scope: req.auth!.student_ids && req.auth!.student_ids.length > 0 ? { studentIds: req.auth!.student_ids } : {},
    })
  }),
)

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body)
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.auth!.id])
    if (!rows[0] || !verifyPassword(body.currentPassword, rows[0].password_hash)) {
      throw badRequest('Current password is incorrect')
    }
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      hashPassword(body.newPassword),
      req.auth!.id,
    ])
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      req.auth!.id,
    ])
    res.status(204).send()
  }),
)

const forgotSchema = z.object({ email: z.string().email() })

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body)
    const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [body.email])
    const token = newToken()
    if (rows.length > 0) {
      // No email provider (spec §13): the reset token is issued and logged.
      logger.info('password reset token issued', { userId: rows[0].id, token })
    }
    res.json({ message: 'If the account exists, a reset token has been issued.' })
  }),
)
