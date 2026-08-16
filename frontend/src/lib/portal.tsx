import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { scholarionApi } from './api'
import { useAsyncData } from './useAsyncData'

interface PortalContextValue {
  studentId: string | null
  studentIds: string[]
  isGuardian: boolean
  setStudentId: (id: string) => void
}

const PortalContext = createContext<PortalContextValue | undefined>(undefined)

export function PortalProvider({ children }: { children: ReactNode }) {
  const { user, scope } = useAuth()
  const isGuardian = user?.role === 'guardian'
  const studentIds = scope.studentIds ?? []
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (studentIds.length && !selected) {
      setSelected(studentIds[0])
    } else if (studentIds.length && !studentIds.includes(selected)) {
      setSelected(studentIds[0])
    } else if (!studentIds.length) {
      setSelected('')
    }
  }, [studentIds, selected])

  const value = useMemo<PortalContextValue>(
    () => ({ studentId: selected, studentIds, isGuardian, setStudentId: setSelected }),
    [selected, studentIds, isGuardian],
  )

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function usePortalStudent(): PortalContextValue {
  const ctx = useContext(PortalContext)
  if (!ctx) throw new Error('usePortalStudent must be used within a PortalProvider')
  return ctx
}

/** Resolves the display names of a guardian's children (or the student's own name). */
export function usePortalChildren() {
  const { studentIds } = usePortalStudent()
  const list = useAsyncData(async () => {
    if (!studentIds.length) return []
    const results = await Promise.all(studentIds.map((id) => scholarionApi.students.get(id)))
    return results.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim() }))
  }, [studentIds.join(',')])
  return list
}
