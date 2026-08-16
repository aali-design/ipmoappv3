import type { ReactNode } from 'react'

export function BarRow({ label, value, max, tone }: { label: ReactNode; value: number; max: number; tone?: 'success' | 'warning' | 'danger' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="bar-row">
      <span className="muted">{label}</span>
      <div className="bar-track">
        <div className={`bar-fill ${tone ?? ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-value">{value.toLocaleString()}</span>
    </div>
  )
}

export function BarList({ rows }: { rows: { label: ReactNode; value: number; tone?: 'success' | 'warning' | 'danger' }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="bar-list">
      {rows.map((r, i) => (
        <BarRow key={i} label={r.label} value={r.value} max={max} tone={r.tone} />
      ))}
    </div>
  )
}
