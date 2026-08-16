export type ErrorCode =
  | 'BadRequest'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'Conflict'
  | 'InvalidTransition'
  | 'ValidationError'
  | 'Unprocessable'
  | 'Locked'
  | 'TooManyRequests'
  | 'SectionFull'
  | 'TimetableConflict'
  | 'TermLocked'
  | 'YearClosed'
  | 'Duplicate'
  | 'InternalError'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  InvalidTransition: 409,
  ValidationError: 400,
  Unprocessable: 422,
  Locked: 423,
  TooManyRequests: 429,
  SectionFull: 422,
  TimetableConflict: 422,
  TermLocked: 423,
  YearClosed: 423,
  Duplicate: 409,
  InternalError: 500,
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown
  readonly isApiError = true as const

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (err as { isApiError?: unknown })?.isApiError === true
}

export const badRequest = (message: string, details?: unknown) => new ApiError('BadRequest', message, details)
export const unauthorized = (message = 'Unauthorized') => new ApiError('Unauthorized', message)
export const forbidden = (message = 'Forbidden') => new ApiError('Forbidden', message)
export const notFound = (message = 'Not found') => new ApiError('NotFound', message)
export const conflict = (message: string) => new ApiError('Conflict', message)
export const validationError = (message: string, details?: unknown) => new ApiError('ValidationError', message, details)
export const unprocessable = (code: ErrorCode, message: string, details?: unknown) => new ApiError(code, message, details)
export const locked = (code: 'Locked' | 'TermLocked' | 'YearClosed', message: string) => new ApiError(code, message)
export const tooManyRequests = (message = 'Too many requests') => new ApiError('TooManyRequests', message)

export function invalidTransition(from: string, to: string, allowed: string[]): ApiError {
  return new ApiError('InvalidTransition', `Cannot transition from "${from}" to "${to}"`, { from, to, allowed })
}
