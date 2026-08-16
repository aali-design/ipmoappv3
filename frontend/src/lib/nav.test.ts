import { describe, expect, it } from 'vitest'
import { homeForRole, NAV_ITEMS, navForRole } from './nav'

describe('navForRole', () => {
  it('returns only items the role may see', () => {
    const admin = navForRole('admin')
    expect(admin.length).toBeGreaterThan(0)
    expect(admin.every((n) => n.roles.includes('admin'))).toBe(true)
  })

  it('scopes student/guardian to the portal section', () => {
    const student = navForRole('student')
    expect(student.length).toBeGreaterThan(0)
    expect(student.every((n) => n.path.startsWith('/portal/'))).toBe(true)
  })

  it('scopes teacher to teacher routes', () => {
    const teacher = navForRole('teacher')
    expect(teacher.length).toBeGreaterThan(0)
    expect(teacher.every((n) => n.path.startsWith('/teacher/'))).toBe(true)
  })

  it('is empty for an unknown role', () => {
    expect(navForRole('unknown' as never)).toEqual([])
  })

  it('exposes the full item list for tests', () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0)
  })
})

describe('homeForRole', () => {
  it('routes teachers to their timetable', () => {
    expect(homeForRole('teacher')).toBe('/teacher/timetable')
  })

  it('routes students and guardians to the portal timetable', () => {
    expect(homeForRole('student')).toBe('/portal/timetable')
    expect(homeForRole('guardian')).toBe('/portal/timetable')
  })

  it('routes every other role to the dashboard', () => {
    expect(homeForRole('admin')).toBe('/')
    expect(homeForRole('accountant')).toBe('/')
    expect(homeForRole('registrar')).toBe('/')
  })
})
