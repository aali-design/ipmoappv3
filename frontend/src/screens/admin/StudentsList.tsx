import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { fullName } from '../../lib/format'
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Select,
  StatusBadge,
  useToast,
} from '../../components'

const PAGE_SIZE = 20

export function StudentsList() {
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [status, setStatus] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQ || undefined,
      status: status || undefined,
      gradeLevelId: gradeId || undefined,
      sectionId: sectionId || undefined,
    }),
    [page, debouncedQ, status, gradeId, sectionId],
  )
  const students = useAsyncData(() => scholarionApi.students.list(params), [JSON.stringify(params)])
  const grades = useAsyncData(() => scholarionApi.gradeLevels.list())
  const sections = useAsyncData(() => scholarionApi.sections.list())

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">Search, filter and manage enrolled students.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreate(true)}>New student</Button>
        </div>
      </div>

      <div className="toolbar">
        <Input
          placeholder="Search by name or admission no."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => {
            setPage(1)
            setDebouncedQ(q)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1)
              setDebouncedQ(q)
            }
          }}
          aria-label="Search students"
          style={{ maxWidth: '20rem' }}
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="applicant">Applicant</option>
          <option value="suspended">Suspended</option>
          <option value="graduated">Graduated</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="transferred">Transferred</option>
        </Select>
        <Select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setPage(1) }} aria-label="Filter by grade">
          <option value="">All grades</option>
          {(grades.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPage(1) }} aria-label="Filter by section">
          <option value="">All sections</option>
          {(sections.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.grade_level?.name} {s.name}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardBody>
          {students.loading ? (
            <LoadingBlock label="Loading students…" />
          ) : students.error ? (
            <ErrorState description={students.error.message} onRetry={students.refetch} />
          ) : !students.data || students.data.items.length === 0 ? (
            <EmptyState title="No students" description="No students match the current filters." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Admission no.</th>
                    <th>Name</th>
                    <th>Grade</th>
                    <th>Section</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students.data.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.admission_no}</td>
                      <td>{fullName(s.first_name, s.last_name)}</td>
                      <td>{s.grade?.name ?? '\u2014'}</td>
                      <td>{s.section?.name ?? '\u2014'}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="cell-actions">
                        <Link className="btn btn-ghost btn-sm" to={`/students/${s.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {students.data && students.data.total > PAGE_SIZE ? (
            <div className="mt-3">
              <Pagination page={students.data.page} pageSize={students.data.pageSize} total={students.data.total} onPage={setPage} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <CreateStudentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          toast('Student created')
          students.refetch()
          setShowCreate(false)
        }}
      />
    </div>
  )
}

function CreateStudentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', admission_no: '', gender: '', date_of_birth: '' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await scholarionApi.students.create({ ...form, status: 'applicant' })
      setForm({ first_name: '', last_name: '', admission_no: '', gender: '', date_of_birth: '' })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create student')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open={open}
      title="New student"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            Create
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        ) : null}
        <Field label="First name" required>
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name" required>
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Admission no.">
          <Input value={form.admission_no} onChange={(e) => setForm({ ...form, admission_no: e.target.value })} />
        </Field>
        <Field label="Gender">
          <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Unspecified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
