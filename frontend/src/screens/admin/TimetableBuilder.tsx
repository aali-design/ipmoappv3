import { useEffect, useMemo, useState } from 'react'
import { scholarionApi } from '../../lib/api'
import { useAsyncData } from '../../lib/useAsyncData'
import { weekdayLabel } from '../../lib/format'
import type { Period, Staff, Subject, TimetableSlot, TimetableViolation } from '../../lib/types'
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Modal,
  Select,
  useToast,
} from '../../components'
import { TimetableGrid } from '../../components/TimetableGrid'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export function TimetableBuilder() {
  const { toast } = useToast()
  const sections = useAsyncData(() => scholarionApi.sections.list())
  const periods = useAsyncData(() => scholarionApi.periods.list())
  const subjects = useAsyncData(() => scholarionApi.subjects.list())
  const teachers = useAsyncData(() => scholarionApi.staff.list())
  const rooms = useAsyncData(() => scholarionApi.rooms.list())

  const [sectionId, setSectionId] = useState('')
  const slots = useAsyncData(() => (sectionId ? scholarionApi.timetable.list({ sectionId }) : Promise.resolve([] as TimetableSlot[])), [sectionId])
  const [conflicts, setConflicts] = useState<Record<string, TimetableViolation[]>>({})
  const [validating, setValidating] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [moveDraft, setMoveDraft] = useState<{ slot: TimetableSlot; weekday: number; periodId: string } | null>(null)
  const [addDraft, setAddDraft] = useState<{ weekday: number; periodId: string }>({ weekday: 1, periodId: '' })

  useEffect(() => {
    if (sections.data?.length && !sectionId) {
      setSectionId(sections.data[0].id)
    }
  }, [sections.data, sectionId])

  const runValidation = async (slotList: TimetableSlot[]) => {
    if (!slotList.length) {
      setConflicts({})
      return
    }
    setValidating(true)
    try {
      const result = await scholarionApi.timetable.validate(slotList)
      const map: Record<string, TimetableViolation[]> = {}
      for (const v of result.violations) {
        const matching = slotList.filter((s) => s.weekday === v.weekday && s.period_id === v.periodId)
        for (const s of matching) {
          ;(map[s.id] ??= []).push(v)
        }
      }
      setConflicts(map)
    } catch {
      setConflicts({})
    } finally {
      setValidating(false)
    }
  }

  useEffect(() => {
    if (slots.data) void runValidation(slots.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.data])

  const selectedSection = (sections.data ?? []).find((s) => s.id === sectionId)

  const suggestedCells = useMemo(() => new Set<string>(), [])

  const handleCellDrop = (weekday: number, periodId: string, slotId: string) => {
    const slot = (slots.data ?? []).find((s) => s.id === slotId)
    if (slot) setMoveDraft({ slot, weekday, periodId })
  }

  const handleEmptyCell = (weekday: number, periodId: string) => {
    setAddDraft({ weekday, periodId })
    setShowAdd(true)
  }

  return (
    <div className="stack stack-lg">
      <div className="page-header">
        <div>
          <h1 className="page-title">Timetable builder</h1>
          <p className="page-subtitle">Assign subjects to the week grid. Conflicts are validated live.</p>
        </div>
        <div className="page-actions">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section" style={{ minWidth: '12rem' }}>
            {(sections.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.grade_level?.name} {s.name}
              </option>
            ))}
          </Select>
          <Button onClick={() => { setAddDraft({ weekday: 1, periodId: (periods.data ?? [])[0]?.id ?? '' }); setShowAdd(true) }}>
            Add slot
          </Button>
        </div>
      </div>

      <div className="timetable-legend">
        <span>
          <span className="legend-dot" style={{ background: 'var(--sch-color-brand-100)' }} />
          Scheduled
        </span>
        <span>
          <span className="legend-dot" style={{ background: 'var(--sch-color-warning-100)' }} />
          Warning
        </span>
        <span>
          <span className="legend-dot" style={{ background: 'var(--sch-color-danger-100)' }} />
          Conflict
        </span>
        <span className="muted">Drag a slot onto a free cell to re-assign it.</span>
      </div>

      {slots.loading ? (
        <LoadingBlock label="Loading timetable…" />
      ) : slots.error ? (
        <ErrorState description={slots.error.message} />
      ) : !selectedSection ? (
        <EmptyState title="No section selected" description="Select a section to build its timetable." />
      ) : (
        <TimetableGrid
          periods={periods.data ?? []}
          slots={slots.data ?? []}
          conflictsBySlotId={conflicts}
          suggestedCells={suggestedCells}
          onSlotClick={() => undefined}
          onCellDrop={handleCellDrop}
          onEmptyCellClick={handleEmptyCell}
          showRoom
        />
      )}

      {validating ? <div className="muted">Validating…</div> : null}

      {showAdd ? (
        <AddSlotModal
          periods={periods.data ?? []}
          subjects={subjects.data ?? []}
          teachers={teachers.data ?? []}
          rooms={rooms.data ?? []}
          sectionId={sectionId}
          initialWeekday={addDraft.weekday}
          initialPeriodId={addDraft.periodId}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false)
            toast('Slot scheduled')
            slots.refetch()
          }}
        />
      ) : null}

      {moveDraft ? (
        <MoveSlotModal
          slot={moveDraft.slot}
          weekday={moveDraft.weekday}
          periodId={moveDraft.periodId}
          periods={periods.data ?? []}
          onClose={() => setMoveDraft(null)}
          onSaved={() => {
            setMoveDraft(null)
            toast('Slot re-assigned')
            slots.refetch()
          }}
        />
      ) : null}
    </div>
  )
}

function AddSlotModal({
  periods,
  subjects,
  teachers,
  rooms,
  sectionId,
  initialWeekday,
  initialPeriodId,
  onClose,
  onCreated,
}: {
  periods: Period[]
  subjects: Subject[]
  teachers: Staff[]
  rooms: { id: string; name: string }[]
  sectionId: string
  initialWeekday: number
  initialPeriodId: string
  onClose: () => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [weekday, setWeekday] = useState(initialWeekday)
  const [periodId, setPeriodId] = useState(initialPeriodId)
  const [pending, setPending] = useState(false)
  const [violations, setViolations] = useState<TimetableViolation[]>([])
  const [validating, setValidating] = useState(false)

  const preview = async () => {
    if (!subjectId || !teacherId || !periodId) return
    setValidating(true)
    try {
      const res = await scholarionApi.timetable.validate({ section_id: sectionId, subject_id: subjectId, teacher_id: teacherId, room_id: roomId || null, weekday, period_id: periodId })
      setViolations(res.violations)
    } catch {
      setViolations([])
    } finally {
      setValidating(false)
    }
  }

  const hasError = violations.some((v) => v.severity === 'error')

  const save = async () => {
    setPending(true)
    try {
      await scholarionApi.timetable.createSlot({ section_id: sectionId, subject_id: subjectId, teacher_id: teacherId, room_id: roomId || null, weekday, period_id: periodId })
      onCreated()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to schedule', 'danger')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      title="Schedule a slot"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void preview()} loading={validating}>
            Check conflicts
          </Button>
          <Button onClick={() => void save()} loading={pending} disabled={hasError || !subjectId || !teacherId || !periodId}>
            Save slot
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid-2">
          <Field label="Subject" required>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Select…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Teacher" required>
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <option value="">Select…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room">
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Unassigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Weekday" required>
            <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {weekdayLabel(d, true)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Period" required>
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Select…</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} {p.starts_at?.slice(0, 5)}–{p.ends_at?.slice(0, 5)}
                {p.is_break ? ' (break)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        {violations.length ? (
          <div className="stack stack-sm">
            {violations.map((v, i) => (
              <Alert key={i} tone={v.severity === 'error' ? 'danger' : 'warning'}>
                {v.severity.toUpperCase()}: {v.message}
              </Alert>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function MoveSlotModal({
  slot,
  weekday,
  periodId,
  periods,
  onClose,
  onSaved,
}: {
  slot: TimetableSlot
  weekday: number
  periodId: string
  periods: Period[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const period = periods.find((p) => p.id === periodId)

  const save = async () => {
    setPending(true)
    try {
      await scholarionApi.timetable.createSlot({
        section_id: slot.section_id,
        subject_id: slot.subject_id,
        teacher_id: slot.teacher_id,
        room_id: slot.room_id ?? null,
        weekday,
        period_id: periodId,
      })
      onSaved()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to re-assign', 'danger')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      title="Re-assign slot"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending}>
            Re-assign
          </Button>
        </>
      }
    >
      <p>
        Move <strong>{slot.subject?.name ?? 'subject'}</strong> ({slot.teacher?.full_name}) to{' '}
        <strong>{weekdayLabel(weekday, true)}</strong>, {period?.label ?? 'period'}.
      </p>
    </Modal>
  )
}
