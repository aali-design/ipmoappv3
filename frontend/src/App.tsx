import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { homeForRole } from './lib/nav'
import type { Role } from './lib/types'
import { AppShell } from './components/AppShell'
import { Spinner } from './components'
import { Login } from './screens/Login'
import { Dashboard } from './screens/admin/Dashboard'
import { StudentsList } from './screens/admin/StudentsList'
import { StudentProfile } from './screens/admin/StudentProfile'
import { TimetableBuilder } from './screens/admin/TimetableBuilder'
import { AcademicSetup } from './screens/admin/AcademicSetup'
import { Fees } from './screens/admin/Fees'
import { Announcements } from './screens/admin/Announcements'
import { AuditLog } from './screens/admin/AuditLog'
import { TeacherTimetable } from './screens/teacher/TeacherTimetable'
import { TeacherStudents } from './screens/teacher/TeacherStudents'
import { AttendanceMarker } from './screens/teacher/AttendanceMarker'
import { TeacherGradebook } from './screens/teacher/Gradebook'
import { TeacherReportCards } from './screens/teacher/ReportCards'
import { PortalTimetable } from './screens/portal/Timetable'
import { PortalAttendance } from './screens/portal/Attendance'
import { PortalGrades } from './screens/portal/Grades'
import { PortalReportCards } from './screens/portal/ReportCards'
import { PortalFees } from './screens/portal/Fees'
import { PortalAnnouncements } from './screens/portal/Announcements'
import { PortalDocuments } from './screens/portal/Documents'

const ADMIN_ROLES: Role[] = ['admin', 'registrar', 'accountant']
const STAFF_ROLES: Role[] = ['admin', 'registrar', 'accountant', 'teacher']

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, status } = useAuth()
  if (status === 'loading') return null
  if (status !== 'authenticated' || !user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />
  return <>{children}</>
}

export function App() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="fullscreen-loading" role="status" aria-live="polite">
        <Spinner size="1.75rem" />
        <span>Loading Scholarion…</span>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireRole roles={['admin', 'registrar', 'accountant', 'teacher', 'student', 'guardian']}>
            <AppShell />
          </RequireRole>
        }
      >
        <Route index element={<RequireRole roles={ADMIN_ROLES}><Dashboard /></RequireRole>} />
        <Route path="students" element={<RequireRole roles={ADMIN_ROLES}><StudentsList /></RequireRole>} />
        <Route path="students/:id" element={<RequireRole roles={STAFF_ROLES}><StudentProfile /></RequireRole>} />
        <Route path="timetable" element={<RequireRole roles={['admin', 'registrar']}><TimetableBuilder /></RequireRole>} />
        <Route path="academic" element={<RequireRole roles={['admin', 'registrar']}><AcademicSetup /></RequireRole>} />
        <Route path="fees" element={<RequireRole roles={['admin', 'accountant']}><Fees /></RequireRole>} />
        <Route path="announcements" element={<RequireRole roles={['admin', 'registrar']}><Announcements /></RequireRole>} />
        <Route path="audit-log" element={<RequireRole roles={['admin']}><AuditLog /></RequireRole>} />

        <Route path="teacher/timetable" element={<RequireRole roles={['teacher']}><TeacherTimetable /></RequireRole>} />
        <Route path="teacher/attendance" element={<RequireRole roles={['teacher']}><AttendanceMarker /></RequireRole>} />
        <Route path="teacher/gradebook" element={<RequireRole roles={['teacher']}><TeacherGradebook /></RequireRole>} />
        <Route path="teacher/report-cards" element={<RequireRole roles={['teacher']}><TeacherReportCards /></RequireRole>} />
        <Route path="teacher/students" element={<RequireRole roles={['teacher']}><TeacherStudents /></RequireRole>} />

        <Route path="portal/timetable" element={<RequireRole roles={['student', 'guardian']}><PortalTimetable /></RequireRole>} />
        <Route path="portal/attendance" element={<RequireRole roles={['student', 'guardian']}><PortalAttendance /></RequireRole>} />
        <Route path="portal/grades" element={<RequireRole roles={['student', 'guardian']}><PortalGrades /></RequireRole>} />
        <Route path="portal/report-cards" element={<RequireRole roles={['student', 'guardian']}><PortalReportCards /></RequireRole>} />
        <Route path="portal/fees" element={<RequireRole roles={['student', 'guardian']}><PortalFees /></RequireRole>} />
        <Route path="portal/announcements" element={<RequireRole roles={['student', 'guardian']}><PortalAnnouncements /></RequireRole>} />
        <Route path="portal/documents" element={<RequireRole roles={['student', 'guardian']}><PortalDocuments /></RequireRole>} />

        <Route path="*" element={<HomeRedirect />} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}

function HomeRedirect() {
  const { user, status } = useAuth()
  if (status === 'loading') return null
  if (status !== 'authenticated' || !user) return <Navigate to="/login" replace />
  return <Navigate to={homeForRole(user.role)} replace />
}
