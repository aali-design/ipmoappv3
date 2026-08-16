import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { forbidden } from '../lib/errors.js'
import { hasPermission, type Permission, type Role } from '../types.js'

/**
 * Require one of the given roles. Relationship/tenant scoping is applied in
 * the data layer; this middleware only gates by role (spec §1).
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth
    if (!auth) return next(forbidden('Authentication required'))
    if (!roles.includes(auth.role)) return next(forbidden(`Requires role: ${roles.join(' or ')}`))
    next()
  }
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth
    if (!auth) return next(forbidden('Authentication required'))
    if (!hasPermission(auth.role, permission)) {
      return next(forbidden(`Requires permission: ${permission}`))
    }
    next()
  }
}
