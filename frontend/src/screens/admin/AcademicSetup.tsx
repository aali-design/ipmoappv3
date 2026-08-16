import { useState, type ReactNode } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { useToast, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, Select, StatusBadge, Tabs } from '../../components'
import { formatDate, titleCase } from '../../lib/format'
import { useAuth } from '../../lib/auth'

interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox'
  options?: { value: string; label: string }[]
  required?: boolean
}

interface Column<T> {
  header: string
  cell: (item: T) => ReactNode
}

interface CrudPanelProps<T> {
  title: string
  fetch: () => Promise<T[]>
  create: (body: Record<string, unknown>) => Promise<T>
  columns: Column<T>[]
  fields: FieldDef[]
  emptyLabel: string
  rowActions?: (item: T, refresh: () => void) => ReactNode
}

function CrudPanel<T extends { id: string }>({ title, fetch, create, columns, fields, emptyLabel, rowActions }: CrudPanelProps<T>) {
  const { toast } = useToast()
  const list = useAsyncData<T[]>(fetch)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <Card>
      <CardHeader
        title={title}
        actions={<Button size="sm" onClick={() => setShowAdd(true)}>Add</Button>}
      />
      <CardBody>
        {list.loading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorState description={list.error.message} onRetry={list.refetch} />
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState title={emptyLabel} />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.header}>{c.header}</th>
                  ))}
                  {rowActions ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {list.data.map((item) => (
                  <tr key={item.id}>
                    {columns.map((c, i) => (
                      <td key={i}>{c.cell(item)}</td>
                    ))}
                    {rowActions ? <td className="cell-actions">{rowActions(item, list.refetch)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      {showAdd ? (
        <CreateModal
          title={`Add ${title.toLowerCase()}`}
          fields={fields}
          onClose={() => setShowAdd(false)}
          onSubmit={async (body) => {
            await create(body)
            toast(`${title} created`)
            list.refetch()
            setShowAdd(false)
          }}
        />
      ) : null}
    </Card>
  )
}

function CreateModal({ title, fields, onClose, onSubmit }: { title: string; fields: FieldDef[]; onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={pending}
            onClick={() => {
              setPending(true)
              setError(null)
              onSubmit(values)
                .catch((err) => setError(err instanceof Error ? err.message : 'Failed'))
                .finally(() => setPending(false))
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
        {fields.map((f) => (
          <Field key={f.name} label={f.label} required={f.required}>
            {f.type === 'select' ? (
              <Select value={String(values[f.name] ?? '')} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />
            ) : (
              <Input
                type={f.type ?? 'text'}
                value={String(values[f.name] ?? '')}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  )
}

export function AcademicSetup() {
  const { timezone, locale } = useAuth()
  const [tab, setTab] = useState('years')
  const { toast } = useToast()

  const years = () => scholarionApi.academicYears.list()
  const terms = () => scholarionApi.terms.list()
  const grades = () => scholarionApi.gradeLevels.list()
  const subjects = () => scholarionApi.subjects.list()
  const rooms = () => scholarionApi.rooms.list()
  const periods = () => scholarionApi.periods.list()
  const scales = () => scholarionApi.gradingScales.list()
  const categories = () => scholarionApi.assessmentCategories.list()

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Academic setup</h1>
          <p className="page-subtitle">Manage years, terms, structure and grading configuration.</p>
        </div>
      </div>

      <Tabs
        ariaLabel="Academic setup sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'years', label: 'Academic years' },
          { id: 'terms', label: 'Terms' },
          { id: 'grades', label: 'Grade levels' },
          { id: 'sections', label: 'Sections' },
          { id: 'subjects', label: 'Subjects' },
          { id: 'rooms', label: 'Rooms' },
          { id: 'periods', label: 'Periods' },
          { id: 'scales', label: 'Grading scales' },
          { id: 'categories', label: 'Categories' },
        ]}
      />

      {tab === 'years' ? (
        <CrudPanel
          title="Academic years"
          fetch={years}
          create={(b) => scholarionApi.academicYears.create(b)}
          emptyLabel="No academic years"
          columns={[
            { header: 'Name', cell: (y) => y.name },
            { header: 'Starts', cell: (y) => formatDate(y.starts_on, { timezone, locale }) },
            { header: 'Ends', cell: (y) => formatDate(y.ends_on, { timezone, locale }) },
            { header: 'Status', cell: (y) => <StatusBadge status={y.status} /> },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'starts_on', label: 'Starts on', type: 'date' },
            { name: 'ends_on', label: 'Ends on', type: 'date' },
          ]}
          rowActions={(y, refresh) => (
            <>
              {y.status !== 'active' ? (
                <Button variant="ghost" size="sm" onClick={() => { void scholarionApi.academicYears.activate(y.id).then(() => { toast('Year activated'); refresh() }) }}>
                  Activate
                </Button>
              ) : null}
              {y.status !== 'closed' ? (
                <Button variant="ghost" size="sm" onClick={() => { void scholarionApi.academicYears.close(y.id).then(() => { toast('Year closed'); refresh() }) }}>
                  Close
                </Button>
              ) : null}
            </>
          )}
        />
      ) : null}

      {tab === 'terms' ? (
        <CrudPanel
          title="Terms"
          fetch={terms}
          create={(b) => scholarionApi.terms.create(b)}
          emptyLabel="No terms"
          columns={[
            { header: 'Name', cell: (t) => t.name },
            { header: 'Sequence', cell: (t) => t.sequence },
            { header: 'Starts', cell: (t) => formatDate(t.starts_on, { timezone, locale }) },
            { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'sequence', label: 'Sequence', type: 'number' },
            { name: 'starts_on', label: 'Starts on', type: 'date' },
            { name: 'ends_on', label: 'Ends on', type: 'date' },
          ]}
          rowActions={(t, refresh) =>
            t.status !== 'locked' ? (
              <Button variant="ghost" size="sm" onClick={() => { void scholarionApi.terms.lock(t.id).then(() => { toast('Term locked'); refresh() }) }}>
                Lock
              </Button>
            ) : null
          }
        />
      ) : null}

      {tab === 'grades' ? (
        <CrudPanel
          title="Grade levels"
          fetch={grades}
          create={(b) => scholarionApi.gradeLevels.create(b)}
          emptyLabel="No grade levels"
          columns={[
            { header: 'Name', cell: (g) => g.name },
            { header: 'Sequence', cell: (g) => g.sequence },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'sequence', label: 'Sequence', type: 'number' },
          ]}
        />
      ) : null}

      {tab === 'sections' ? (
        <SectionPanel />
      ) : null}

      {tab === 'subjects' ? (
        <CrudPanel
          title="Subjects"
          fetch={subjects}
          create={(b) => scholarionApi.subjects.create(b)}
          emptyLabel="No subjects"
          columns={[
            { header: 'Code', cell: (s) => s.code },
            { header: 'Name', cell: (s) => s.name },
            { header: 'Credit hours', cell: (s) => String(s.credit_hours) },
            { header: 'Elective', cell: (s) => (s.is_elective ? 'Yes' : 'No') },
          ]}
          fields={[
            { name: 'code', label: 'Code', required: true },
            { name: 'name', label: 'Name', required: true },
            { name: 'credit_hours', label: 'Credit hours', type: 'number' },
            { name: 'is_elective', label: 'Elective', type: 'checkbox' },
          ]}
        />
      ) : null}

      {tab === 'rooms' ? (
        <CrudPanel
          title="Rooms"
          fetch={rooms}
          create={(b) => scholarionApi.rooms.create(b)}
          emptyLabel="No rooms"
          columns={[
            { header: 'Name', cell: (r) => r.name },
            { header: 'Kind', cell: (r) => titleCase(r.kind) },
            { header: 'Capacity', cell: (r) => r.capacity },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'kind', label: 'Kind', type: 'select', options: ['classroom', 'lab', 'gym', 'hall'].map((v) => ({ value: v, label: titleCase(v) })) },
            { name: 'capacity', label: 'Capacity', type: 'number' },
          ]}
        />
      ) : null}

      {tab === 'periods' ? (
        <CrudPanel
          title="Periods"
          fetch={periods}
          create={(b) => scholarionApi.periods.create(b)}
          emptyLabel="No periods"
          columns={[
            { header: 'Label', cell: (p) => p.label },
            { header: 'Sequence', cell: (p) => p.sequence },
            { header: 'Time', cell: (p) => `${p.starts_at?.slice(0, 5)}–${p.ends_at?.slice(0, 5)}` },
            { header: 'Break', cell: (p) => (p.is_break ? 'Yes' : 'No') },
          ]}
          fields={[
            { name: 'label', label: 'Label', required: true },
            { name: 'sequence', label: 'Sequence', type: 'number' },
            { name: 'starts_at', label: 'Starts at (HH:MM)', required: true },
            { name: 'ends_at', label: 'Ends at (HH:MM)', required: true },
            { name: 'is_break', label: 'Break', type: 'checkbox' },
          ]}
        />
      ) : null}

      {tab === 'scales' ? (
        <CrudPanel
          title="Grading scales"
          fetch={scales}
          create={(b) => scholarionApi.gradingScales.create(b)}
          emptyLabel="No grading scales"
          columns={[
            { header: 'Name', cell: (s) => s.name },
            { header: 'Bands', cell: (s) => `${s.bands_json?.length ?? 0} bands` },
            { header: 'Default', cell: (s) => (s.is_default ? 'Yes' : 'No') },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'is_default', label: 'Default', type: 'checkbox' },
          ]}
        />
      ) : null}

      {tab === 'categories' ? (
        <CrudPanel
          title="Assessment categories"
          fetch={categories}
          create={(b) => scholarionApi.assessmentCategories.create(b)}
          emptyLabel="No categories"
          columns={[
            { header: 'Name', cell: (c) => c.name },
            { header: 'Weight %', cell: (c) => String(c.weight_pct) },
            { header: 'Drop lowest', cell: (c) => c.drop_lowest },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'weight_pct', label: 'Weight %', type: 'number' },
            { name: 'drop_lowest', label: 'Drop lowest', type: 'number' },
          ]}
        />
      ) : null}
    </div>
  )
}

function SectionPanel() {
  const grades = useAsyncData(() => scholarionApi.gradeLevels.list())
  const staff = useAsyncData(() => scholarionApi.staff.list())

  return (
    <CrudPanel
      title="Sections"
      fetch={() => scholarionApi.sections.list()}
      create={(b) => scholarionApi.sections.create(b)}
      emptyLabel="No sections"
      columns={[
        { header: 'Name', cell: (s) => s.name },
        { header: 'Grade', cell: (s) => s.grade_level?.name ?? '\u2014' },
        { header: 'Capacity', cell: (s) => s.capacity },
        { header: 'Enrolled', cell: (s) => s.enrollment_count ?? '\u2014' },
        { header: 'Homeroom', cell: (s) => s.homeroom_teacher?.full_name ?? '\u2014' },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'grade_level_id', label: 'Grade level', type: 'select', options: (grades.data ?? []).map((g) => ({ value: g.id, label: g.name })) },
        { name: 'capacity', label: 'Capacity', type: 'number' },
        { name: 'homeroom_teacher_id', label: 'Homeroom teacher', type: 'select', options: (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name })) },
      ]}
    />
  )
}
