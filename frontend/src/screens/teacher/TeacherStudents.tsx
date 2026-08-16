import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useTeacherStaffId, uniqueSectionIds } from '../../lib/useTeacherStaffId'
import { fullName } from '../../lib/format'
import { Card, CardBody, EmptyState, ErrorState, LoadingBlock, Select } from '../../components'

export function TeacherStudents() {
  const staffId = useTeacherStaffId()
  const slots = useAsyncData(
    () => (staffId ? scholarionApi.timetable.teacherTimetable(staffId) : Promise.resolve([])),
    [staffId],
  )
  const sections = useAsyncData(() => scholarionApi.sections.list())
  const sectionIds = useMemo(() => uniqueSectionIds(slots.data ?? []), [slots.data])
  const [sectionId, setSectionId] = useState('')
  const effectiveSection = sectionId || sectionIds[0] || ''
  const roster = useAsyncData(
    () => (effectiveSection ? scholarionApi.sections.roster(effectiveSection) : Promise.resolve([])),
    [effectiveSection],
  )

  const sectionOptions = (sections.data ?? []).filter((s) => sectionIds.includes(s.id))

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">My students</h1>
          <p className="page-subtitle">Students in the sections you teach.</p>
        </div>
        <Select value={effectiveSection} onChange={(e) => setSectionId(e.target.value)} aria-label="Section" style={{ minWidth: '12rem' }}>
          {sectionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.grade_level?.name} {s.name}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardBody>
          {!effectiveSection ? (
            <EmptyState title="No assigned sections" description="You have no teaching assignments yet." />
          ) : roster.loading ? (
            <LoadingBlock />
          ) : roster.error ? (
            <ErrorState description={roster.error.message} />
          ) : !roster.data?.length ? (
            <EmptyState title="No students" />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Roll no.</th>
                    <th>Name</th>
                    <th>Admission no.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.data.map((e) => (
                    <tr key={e.id}>
                      <td>{e.roll_no ?? '\u2014'}</td>
                      <td>{fullName(e.student?.first_name, e.student?.last_name)}</td>
                      <td>{e.student?.admission_no ?? '\u2014'}</td>
                      <td className="cell-actions">
                        {e.student ? (
                          <Link className="btn btn-ghost btn-sm" to={`/students/${e.student.id}`}>
                            Profile
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
