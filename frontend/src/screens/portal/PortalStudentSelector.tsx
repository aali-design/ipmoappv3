import { Select } from '../../components'
import { usePortalChildren, usePortalStudent } from '../../lib/portal'

/**
 * Child selector for the student/guardian portal. Students see nothing (their
 * id is fixed); guardians get a dropdown to switch between their children.
 */
export function PortalStudentSelector() {
  const { studentId, studentIds, isGuardian, setStudentId } = usePortalStudent()
  const children = usePortalChildren()

  if (!isGuardian) return null
  if (studentIds.length <= 1) return null

  return (
    <Select value={studentId ?? ''} onChange={(e) => setStudentId(e.target.value)} aria-label="Student" style={{ minWidth: '12rem' }}>
      {children.data?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  )
}

/** Resolve the display name of the currently selected portal student. */
export function usePortalStudentName(): string {
  const { studentId } = usePortalStudent()
  const children = usePortalChildren()
  return children.data?.find((c) => c.id === studentId)?.name ?? ''
}
