export type Role = 'admin' | 'registrar' | 'accountant' | 'teacher' | 'student' | 'guardian'

export const ROLES: Role[] = ['admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian']

export interface AuthUser {
  id: string
  school_id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  last_login_at?: string | null
  /** student role: the student's own `students.id`; guardian: not used */
  student_id?: string
  /** guardian role: ids of linked children; student role: [own id] */
  student_ids?: string[]
  /** teacher role: the staff row id */
  staff_id?: string
}

export type Permission =
  | 'manageSchool'
  | 'enroll'
  | 'timetable'
  | 'attendance'
  | 'marks'
  | 'submitReports'
  | 'publishReports'
  | 'fees'
  | 'communications'

/**
 * Role matrix (spec §1). Scoping invariants (tenant isolation, relationship
 * scoping) are enforced separately in the data layer, not by this matrix.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'manageSchool',
    'enroll',
    'timetable',
    'attendance',
    'marks',
    'submitReports',
    'publishReports',
    'fees',
    'communications',
  ],
  registrar: ['enroll', 'timetable'],
  accountant: ['fees'],
  teacher: ['attendance', 'marks', 'submitReports'],
  student: [],
  guardian: [],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string
      auth?: AuthUser
    }
  }
}

export {}
