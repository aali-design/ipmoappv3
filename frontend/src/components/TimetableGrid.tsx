import type { Period, TimetableSlot, TimetableViolation } from '../lib/types'
import { weekdayLabel } from '../lib/format'
import { Badge } from './Badge'

export interface TimetableGridProps {
  periods: Period[]
  slots: TimetableSlot[]
  weekdays?: number[]
  /** Slot id → violations, for conflict badges (timetable builder). */
  conflictsBySlotId?: Record<string, TimetableViolation[]>
  /** Optional highlight for suggested free cells: `${weekday}:${periodId}` */
  suggestedCells?: Set<string>
  onSlotClick?: (slot: TimetableSlot) => void
  onCellDrop?: (weekday: number, periodId: string, slotId: string) => void
  onEmptyCellClick?: (weekday: number, periodId: string) => void
  showRoom?: boolean
}

function slotKey(weekday: number, periodId: string): string {
  return `${weekday}:${periodId}`
}

export function TimetableGrid({
  periods,
  slots,
  weekdays = [1, 2, 3, 4, 5, 6, 7],
  conflictsBySlotId,
  suggestedCells,
  onSlotClick,
  onCellDrop,
  onEmptyCellClick,
  showRoom = false,
}: TimetableGridProps) {
  const ordered = [...periods].sort((a, b) => a.sequence - b.sequence)
  const byCell = new Map<string, TimetableSlot[]>()
  for (const slot of slots) {
    const key = slotKey(slot.weekday, slot.period_id)
    const list = byCell.get(key) ?? []
    list.push(slot)
    byCell.set(key, list)
  }

  return (
    <div className="table-scroll">
      <table className="table timetable-grid">
        <thead>
          <tr>
            <th style={{ width: '6rem' }}>Period</th>
            {weekdays.map((d) => (
              <th key={d}>{weekdayLabel(d, true)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((period) => (
            <tr key={period.id}>
              <th scope="row">
                <div>{period.label}</div>
                <div className="muted" style={{ fontWeight: '400', textTransform: 'none' }}>
                  {period.starts_at?.slice(0, 5)}
                </div>
              </th>
              {weekdays.map((weekday) => {
                const cellSlots = byCell.get(slotKey(weekday, period.id)) ?? []
                const isBreak = period.is_break
                const suggested = suggestedCells?.has(slotKey(weekday, period.id)) ?? false
                return (
                  <td
                    key={weekday}
                    className={isBreak ? 'tt-break' : ''}
                    onDragOver={(e) => {
                      if (onCellDrop && !isBreak) e.preventDefault()
                    }}
                    onDrop={(e) => {
                      if (!onCellDrop || isBreak) return
                      e.preventDefault()
                      const slotId = e.dataTransfer.getData('text/scholarion-slot')
                      if (slotId) onCellDrop(weekday, period.id, slotId)
                    }}
                    onClick={() => {
                      if (cellSlots.length === 0 && onEmptyCellClick && !isBreak) {
                        onEmptyCellClick(weekday, period.id)
                      }
                    }}
                  >
                    {suggested ? <span className="badge badge-info tt-suggest">Suggested</span> : null}
                    {cellSlots.map((slot) => {
                      const conflicts = conflictsBySlotId?.[slot.id]
                      const hasError = conflicts?.some((c) => c.severity === 'error')
                      return (
                        <div
                          key={slot.id}
                          className={`tt-slot ${hasError ? 'tt-slot-error' : conflicts?.length ? 'tt-slot-warning' : ''}`}
                          draggable={Boolean(onCellDrop)}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/scholarion-slot', slot.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSlotClick?.(slot)
                          }}
                          title={conflicts?.map((c) => c.message).join('\n')}
                        >
                          <div className="tt-slot-subject">{slot.subject?.name ?? slot.subject_id}</div>
                          <div className="tt-slot-meta">{slot.teacher?.full_name ?? ''}</div>
                          {showRoom && slot.room ? <div className="tt-slot-meta">{slot.room.name}</div> : null}
                          {hasError ? (
                            <Badge tone="danger">&nbsp;!&nbsp;</Badge>
                          ) : conflicts?.length ? (
                            <Badge tone="warning">&nbsp;!&nbsp;</Badge>
                          ) : null}
                        </div>
                      )
                    })}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
