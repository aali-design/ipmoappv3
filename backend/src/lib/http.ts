import type { NextFunction, Request, RequestHandler, Response } from 'express'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export interface Pagination {
  page: number
  pageSize: number
  offset: number
  limit: number
}

export function parsePagination(query: Record<string, unknown>, maxPageSize = 200): Pagination {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER)
  const pageSize = clampInt(query.pageSize, 20, 1, maxPageSize)
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize }
}
