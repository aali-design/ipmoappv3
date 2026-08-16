import type { ReactNode } from 'react'

export function StatCard({ label, value, delta, deltaTone = 'neutral' }: { label: ReactNode; value: ReactNode; delta?: ReactNode; deltaTone?: 'neutral' | 'positive' | 'negative' }) {
  const deltaClass = deltaTone === 'positive' ? 'text-success' : deltaTone === 'negative' ? 'text-danger' : ''
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta ? <span className={`stat-delta ${deltaClass}`}>{delta}</span> : null}
    </div>
  )
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span className="avatar" aria-hidden="true">
      {initials}
    </span>
  )
}
