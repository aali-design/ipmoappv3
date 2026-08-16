import type { Role } from './types'
import type { IconName } from '../components/Icon'

export interface NavItem {
  path: string
  label: string
  icon: IconName
  roles: Role[]
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', roles: ['admin', 'registrar', 'accountant'], end: true },
  { path: '/students', label: 'Students', icon: 'users', roles: ['admin', 'registrar', 'accountant'] },
  { path: '/timetable', label: 'Timetable', icon: 'calendar', roles: ['admin', 'registrar'] },
  { path: '/academic', label: 'Academic', icon: 'settings', roles: ['admin', 'registrar'] },
  { path: '/fees', label: 'Fees', icon: 'currency', roles: ['admin', 'accountant'] },
  { path: '/announcements', label: 'Announcements', icon: 'megaphone', roles: ['admin', 'registrar'] },
  { path: '/audit-log', label: 'Audit Log', icon: 'list', roles: ['admin'] },
  // Teacher
  { path: '/teacher/timetable', label: 'My Timetable', icon: 'calendar', roles: ['teacher'] },
  { path: '/teacher/attendance', label: 'Attendance', icon: 'check', roles: ['teacher'] },
  { path: '/teacher/gradebook', label: 'Gradebook', icon: 'book', roles: ['teacher'] },
  { path: '/teacher/report-cards', label: 'Report Cards', icon: 'file', roles: ['teacher'] },
  { path: '/teacher/students', label: 'My Students', icon: 'users', roles: ['teacher'] },
  // Student / guardian portal
  { path: '/portal/timetable', label: 'Timetable', icon: 'calendar', roles: ['student', 'guardian'] },
  { path: '/portal/attendance', label: 'Attendance', icon: 'clock', roles: ['student', 'guardian'] },
  { path: '/portal/grades', label: 'Grades', icon: 'chart', roles: ['student', 'guardian'] },
  { path: '/portal/report-cards', label: 'Report Cards', icon: 'file', roles: ['student', 'guardian'] },
  { path: '/portal/fees', label: 'Fees', icon: 'currency', roles: ['student', 'guardian'] },
  { path: '/portal/announcements', label: 'Announcements', icon: 'megaphone', roles: ['student', 'guardian'] },
  { path: '/portal/documents', label: 'Documents', icon: 'file', roles: ['student', 'guardian'] },
]

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((n) => n.roles.includes(role))
}

export function homeForRole(role: Role): string {
  switch (role) {
    case 'teacher':
      return '/teacher/timetable'
    case 'student':
    case 'guardian':
      return '/portal/timetable'
    default:
      return '/'
  }
}
