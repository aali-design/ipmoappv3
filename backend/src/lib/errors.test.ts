import { describe, expect, it } from 'vitest'
import {
  ApiError,
  forbidden,
  invalidTransition,
  isApiError,
  locked,
  notFound,
  tooManyRequests,
  unauthorized,
  unprocessable,
} from './errors.js'

describe('ApiError — status code mapping', () => {
  it('maps every code to its HTTP status', () => {
    expect(new ApiError('BadRequest', 'x').status).toBe(400)
    expect(new ApiError('Unauthorized', 'x').status).toBe(401)
    expect(new ApiError('Forbidden', 'x').status).toBe(403)
    expect(new ApiError('NotFound', 'x').status).toBe(404)
    expect(new ApiError('Conflict', 'x').status).toBe(409)
    expect(new ApiError('InvalidTransition', 'x').status).toBe(409)
    expect(new ApiError('Unprocessable', 'x').status).toBe(422)
    expect(new ApiError('TooManyRequests', 'x').status).toBe(429)
    expect(new ApiError('InternalError', 'x').status).toBe(500)
  })
})

describe('ApiError — helpers', () => {
  it('constructs forbidden with 403', () => {
    const e = forbidden('nope')
    expect(e.code).toBe('Forbidden')
    expect(e.status).toBe(403)
  })

  it('constructs unauthorized with default message', () => {
    const e = unauthorized()
    expect(e.code).toBe('Unauthorized')
    expect(e.status).toBe(401)
  })

  it('constructs notFound with 404', () => {
    expect(notFound().status).toBe(404)
  })

  it('constructs unprocessable with an explicit code and details', () => {
    const e = unprocessable('TimetableConflict', 'clash', { a: 1 })
    expect(e.code).toBe('TimetableConflict')
    expect(e.status).toBe(422)
    expect(e.details).toEqual({ a: 1 })
  })

  it('constructs locked transitions', () => {
    expect(locked('TermLocked', 'locked').status).toBe(423)
    expect(locked('YearClosed', 'closed').code).toBe('YearClosed')
  })

  it('constructs tooManyRequests', () => {
    expect(tooManyRequests().status).toBe(429)
  })

  it('invalidTransition embeds from/to/allowed details', () => {
    const e = invalidTransition('paid', 'void', ['issued'])
    expect(e.code).toBe('InvalidTransition')
    expect(e.status).toBe(409)
    expect(e.details).toEqual({ from: 'paid', to: 'void', allowed: ['issued'] })
  })
})

describe('isApiError', () => {
  it('detects ApiError instances', () => {
    expect(isApiError(new ApiError('Forbidden', 'x'))).toBe(true)
  })

  it('detects structurally-compatible objects', () => {
    expect(isApiError({ isApiError: true })).toBe(true)
  })

  it('rejects plain errors and unknown values', () => {
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError('x')).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})
