import type { NextFunction, Request, Response } from 'express'
import { tooManyRequests } from '../lib/errors.js'

/**
 * In-memory sliding-window rate limiter keyed by IP (spec §8: auth 10/min/IP).
 * Single-instance scope is acceptable for the auth surface.
 */
const buckets = new Map<string, number[]>()

export function rateLimit(windowMs: number, max: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
    if (timestamps.length >= max) {
      next(tooManyRequests('Too many requests, slow down'))
      return
    }
    timestamps.push(now)
    buckets.set(key, timestamps)
    next()
  }
}
