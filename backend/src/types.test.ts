import { describe, expect, it } from 'vitest'
import {
  hasPermission,
  ROLES,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from './types.js'

describe('RBAC role matrix (spec §1)', () => {
  it('defines all six roles', () => {
    expect(ROLES).toEqual(['admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian'])
  })

  it('grants admin every permission', () => {
    for (const permission of ROLE_PERMISSIONS.admin) {
      expect(hasPermission('admin', permission), `admin should hold ${permission}`).toBe(true)
    }
  })

  it('limits registrar to enroll + timetable', () => {
    expect(hasPermission('registrar', 'enroll')).toBe(true)
    expect(hasPermission('registrar', 'timetable')).toBe(true)
    expect(hasPermission('registrar', 'fees')).toBe(false)
    expect(hasPermission('registrar', 'marks')).toBe(false)
    expect(hasPermission('registrar', 'manageSchool')).toBe(false)
  })

  it('limits accountant to fees only', () => {
    expect(hasPermission('accountant', 'fees')).toBe(true)
    expect(hasPermission('accountant', 'enroll')).toBe(false)
    expect(hasPermission('accountant', 'publishReports')).toBe(false)
  })

  it('limits teacher to attendance, marks, and submitReports', () => {
    expect(hasPermission('teacher', 'attendance')).toBe(true)
    expect(hasPermission('teacher', 'marks')).toBe(true)
    expect(hasPermission('teacher', 'submitReports')).toBe(true)
    expect(hasPermission('teacher', 'publishReports')).toBe(false)
    expect(hasPermission('teacher', 'fees')).toBe(false)
    expect(hasPermission('teacher', 'manageSchool')).toBe(false)
  })

  it('denies all permissions to student and guardian', () => {
    for (const role of ['student', 'guardian'] as Role[]) {
      for (const permission of ROLE_PERMISSIONS.admin) {
        expect(hasPermission(role, permission), `${role} should not hold ${permission}`).toBe(false)
      }
    }
  })

  it('matrix is complete — every role has an entry with no unknown permissions', () => {
    const validPermissions = new Set<Permission>(ROLE_PERMISSIONS.admin)
    for (const role of ROLES) {
      const perms = ROLE_PERMISSIONS[role]
      expect(perms).toBeDefined()
      for (const p of perms) {
        expect(validPermissions.has(p), `${role} has unknown permission ${p}`).toBe(true)
      }
    }
  })
})
