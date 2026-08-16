import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../lib/jwt.js'
import { unauthorized } from '../lib/errors.js'
import { buildAuthUser } from '../services/auth.js'
import { asyncHandler } from '../lib/http.js'

/**
 * JWT bearer authentication. Tenant isolation: the caller's school_id is taken
 * from the verified token, never from request body/params (spec §1).
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token')
    }
    const token = header.slice('Bearer '.length).trim()
    let claims
    try {
      claims = verifyAccessToken(token)
    } catch {
      throw unauthorized('Invalid or expired token')
    }
    const user = await buildAuthUser(claims.sub)
    if (!user || !user.is_active) {
      throw unauthorized('Account unavailable')
    }
    req.auth = user
    next()
  },
)
