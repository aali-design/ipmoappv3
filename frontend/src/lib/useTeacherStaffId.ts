import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { scholarionApi } from './api'

/**
 * Resolves the signed-in teacher's staff id. Prefers `scope.staffId` from
 * `/auth/me`; falls back to matching the staff record by user id.
 */
export function useTeacherStaffId(): string | null {
  const { scope, user } = useAuth()
  const [staffId, setStaffId] = useState<string | null>(scope.staffId ?? null)

  useEffect(() => {
    if (scope.staffId) {
      setStaffId(scope.staffId)
      return
    }
    if (user?.role !== 'teacher') {
      setStaffId(null)
      return
    }
    let cancelled = false
    scholarionApi
      .staff.list()
      .then((staff) => {
        const match = staff.find((s) => s.user_id === user.id || s.user?.id === user.id)
        if (!cancelled) setStaffId(match?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setStaffId(null)
      })
    return () => {
      cancelled = true
    }
  }, [scope.staffId, user])

  return staffId
}

/** Derive the sections a teacher is assigned to from their timetable slots. */
export function uniqueSectionIds(slots: { section_id: string; section?: { id: string; name: string } }[]): string[] {
  return Array.from(new Set(slots.map((s) => s.section_id)))
}
