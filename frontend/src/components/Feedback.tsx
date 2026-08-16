import type { ReactNode } from 'react'
import { Button } from './Button'

export function Spinner({ size = '1.25rem' }: { size?: string }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function Skeleton({ height = '1rem', width = '100%', className = '' }: { height?: string; width?: string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height, width }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height="2.5rem" />
      ))}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <h3>{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: ReactNode; description?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <h3>{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Retry</Button> : null}
    </div>
  )
}

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>
}
