import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    logger.info('request', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
    })
  })

  next()
}
