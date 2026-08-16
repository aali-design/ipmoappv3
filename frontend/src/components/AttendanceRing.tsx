import { formatPercent } from '../lib/format'

export function AttendanceRing({ percent, label = 'attendance' }: { percent: number | null | undefined; label?: string }) {
  const value = percent ?? 0
  const r = 40
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, value))
  const offset = c - (clamped / 100) * c
  const tone = value >= 75 ? 'var(--sch-color-success-500)' : 'var(--sch-color-danger-500)'

  return (
    <div className="attendance-ring">
      <svg width={96} height={96} viewBox="0 0 100 100" role="img" aria-label={`${formatPercent(value, 0)} ${label}`}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--sch-color-neutral-200)" strokeWidth={10} />
        <circle
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
        <text x={50} y={50} textAnchor="middle" dominantBaseline="central" fill="var(--sch-text-primary)" fontSize={18} fontWeight={600}>
          {formatPercent(value, 0)}
        </text>
      </svg>
      <div>
        <div className="ring-value">{formatPercent(value)}</div>
        <div className="muted" style={{ fontSize: 'var(--sch-font-size-sm)' }}>
          {label}
        </div>
      </div>
    </div>
  )
}
