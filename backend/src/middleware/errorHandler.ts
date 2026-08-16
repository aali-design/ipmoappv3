import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { isApiError, ApiError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'NotFound', message: 'Route not found' })
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'ValidationError',
      message: 'Request validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }

  if (isApiError(err)) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    })
    return
  }

  const status = (err as { status?: number })?.status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'BadRequest', message: (err as Error).message })
    return
  }

  // Postgres unique-violation -> 409 Duplicate
  const pg = err as { code?: string; constraint?: string }
  if (pg.code === '23505') {
    res.status(409).json({
      error: 'Duplicate',
      message: 'A record with the same unique key already exists',
      details: { constraint: pg.constraint },
    })
    return
  }
  if (pg.code === '23503') {
    res.status(422).json({ error: 'Unprocessable', message: 'Referenced record does not exist' })
    return
  }

  logger.error('unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  })
  res.status(500).json({ error: 'InternalError', message: 'Internal server error' })
}
