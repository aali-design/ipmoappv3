import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { requireRole, requirePermission } from './rbac.js'
import type { AuthUser } from '../types.js'
import { isApiError } from '../lib/errors.js'

function user(role: AuthUser['role']): AuthUser {
  return { id: 'u1', school_id: 's1', email: 'a@b.c', full_name: 'Ada', role, is_active: true }
}

function req(auth?: AuthUser): Request {
  return { auth } as unknown as Request
}

const next = () => vi.fn()

describe('requireRole', () => {
  it('allows a matching role through', () => {
    const cb = next()
    requireRole('admin')(req(user('admin')), {} as Response, cb as NextFunction)
    expect(cb).toHaveBeenCalledWith()
  })

  it('rejects a request with no auth context', () => {
    const cb = next()
    requireRole('admin')(req(undefined), {} as Response, cb as NextFunction)
    const err = cb.mock.calls[0][0]
    expect(isApiError(err)).toBe(true)
    expect((err as { status: number }).status).toBe(403)
  })

  it('rejects a non-matching role with a forbidden error naming the roles', () => {
    const cb = next()
    requireRole('admin', 'registrar')(req(user('teacher')), {} as Response, cb as NextFunction)
    const err = cb.mock.calls[0][0] as { status: number; message: string }
    expect(err.status).toBe(403)
    expect(err.message).toContain('Requires role')
  })

  it('accepts any of several roles', () => {
    const cb = next()
    requireRole('teacher', 'registrar')(req(user('teacher')), {} as Response, cb as NextFunction)
    expect(cb).toHaveBeenCalledWith()
  })
})

describe('requirePermission', () => {
  it('allows a role that holds the permission', () => {
    const cb = next()
    requirePermission('fees')(req(user('accountant')), {} as Response, cb as NextFunction)
    expect(cb).toHaveBeenCalledWith()
  })

  it('rejects a role without the permission', () => {
    const cb = next()
    requirePermission('fees')(req(user('teacher')), {} as Response, cb as NextFunction)
    const err = cb.mock.calls[0][0] as { status: number; message: string }
    expect(err.status).toBe(403)
    expect(err.message).toContain('Requires permission')
  })

  it('rejects when auth is missing', () => {
    const cb = next()
    requirePermission('manageSchool')(req(undefined), {} as Response, cb as NextFunction)
    expect(isApiError(cb.mock.calls[0][0])).toBe(true)
  })
})
