import { useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../lib/useAsyncData'
import { formatDate } from '../../lib/format'
import type { Role } from '../../lib/types'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Textarea,
  useToast,
} from '../../components'

const AUDIENCE_ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'registrar', label: 'Registrar' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'teacher', label: 'Teachers' },
  { value: 'student', label: 'Students' },
  { value: 'guardian', label: 'Guardians' },
]

export function Announcements() {
  const { timezone, locale } = useAuth()
  const { toast } = useToast()
  const list = useAsyncData(() => scholarionApi.announcements.list())
  const grades = useAsyncData(() => scholarionApi.gradeLevels.list())
  const sections = useAsyncData(() => scholarionApi.sections.list())

  const [showComposer, setShowComposer] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [gradeIds, setGradeIds] = useState<string[]>([])
  const [sectionIds, setSectionIds] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await scholarionApi.announcements.create({
        title,
        body,
        audience_json: {
          roles: roles.length ? roles : undefined,
          grade_level_ids: gradeIds.length ? gradeIds : undefined,
          section_ids: sectionIds.length ? sectionIds : undefined,
        },
      })
      toast('Announcement published')
      setShowComposer(false)
      setTitle('')
      setBody('')
      setRoles([])
      setGradeIds([])
      setSectionIds([])
      list.refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">Compose and target announcements by audience.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowComposer(true)}>Compose</Button>
        </div>
      </div>

      {showComposer ? (
        <Card>
          <CardHeader title="New announcement" />
          <CardBody className="stack">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label="Title" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message" required>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <Field label="Audience" hint="Leave a category empty to include everyone in it.">
              <div className="stack stack-sm">
                <div>
                  <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Roles</div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {AUDIENCE_ROLES.map((r) => (
                      <label key={r.value} className="checkbox-row">
                        <input type="checkbox" checked={roles.includes(r.value)} onChange={() => toggle(roles, r.value, setRoles)} />
                        <span>{r.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Grade levels</div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {(grades.data ?? []).map((g) => (
                      <label key={g.id} className="checkbox-row">
                        <input type="checkbox" checked={gradeIds.includes(g.id)} onChange={() => toggle(gradeIds, g.id, setGradeIds)} />
                        <span>{g.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Sections</div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {(sections.data ?? []).map((s) => (
                      <label key={s.id} className="checkbox-row">
                        <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggle(sectionIds, s.id, setSectionIds)} />
                        <span>{s.grade_level?.name} {s.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </Field>
            <div className="row">
              <Button variant="secondary" onClick={() => setShowComposer(false)}>Cancel</Button>
              <Button loading={pending} disabled={!title || !body} onClick={() => void submit()}>Publish</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Published" />
        <CardBody>
          {list.loading ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorState description={list.error.message} />
          ) : !list.data?.length ? (
            <EmptyState title="No announcements" />
          ) : (
            <div className="stack">
              {list.data.map((a) => (
                <div key={a.id} className="card-body" style={{ border: '1px solid var(--sch-border-default)', borderRadius: 'var(--sch-radius-md)' }}>
                  <div className="row-between">
                    <span style={{ fontWeight: '600' }}>{a.title}</span>
                    <span className="muted">{formatDate(a.publish_at ?? undefined, { timezone, locale })}</span>
                  </div>
                  <p className="mt-1">{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
