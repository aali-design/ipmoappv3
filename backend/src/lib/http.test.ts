import { describe, expect, it, vi } from 'vitest'
import { asyncHandler, paginated, parsePagination } from './http.js'

describe('parsePagination', () => {
  it('uses defaults when no params are present', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 })
  })

  it('parses page and pageSize and computes offset', () => {
    expect(parsePagination({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50, offset: 100, limit: 50 })
  })

  it('clamps sub-minimum values to the floor', () => {
    expect(parsePagination({ page: '-5', pageSize: '0' })).toEqual({ page: 1, pageSize: 1, offset: 0, limit: 1 })
  })

  it('clamps pageSize to the configured maximum', () => {
    expect(parsePagination({ pageSize: '99999' }, 200)).toEqual({ page: 1, pageSize: 200, offset: 0, limit: 200 })
  })

  it('falls back to defaults for non-numeric input', () => {
    expect(parsePagination({ page: 'abc', pageSize: 'xyz' })).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 })
  })
})

describe('paginated', () => {
  it('wraps items with paging metadata', () => {
    expect(paginated(['a', 'b'], 42, 2, 20)).toEqual({ items: ['a', 'b'], total: 42, page: 2, pageSize: 20 })
  })
})

describe('asyncHandler', () => {
  it('does not touch next when the handler resolves', async () => {
    const cb = vi.fn()
    const handler = asyncHandler(async () => 'ok')
    handler({} as never, {} as never, cb)
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).not.toHaveBeenCalled()
  })

  it('routes an async rejection to next', async () => {
    const boom = new Error('boom')
    const cb = vi.fn()
    const handler = asyncHandler(async () => {
      throw boom
    })
    handler({} as never, {} as never, cb)
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledWith(boom)
  })
})
