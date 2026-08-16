import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

const TONE_BY_STATUS: Record<string, BadgeTone> = {
  // student / enrollment
  active: 'success',
  enrolled: 'success',
  applicant: 'info',
  suspended: 'danger',
  graduated: 'brand',
  withdrawn: 'neutral',
  transferred: 'warning',
  promoted: 'success',
  repeated: 'warning',
  // invoice
  paid: 'success',
  issued: 'info',
  partially_paid: 'warning',
  overdue: 'danger',
  draft: 'neutral',
  void: 'neutral',
  // term/year
  planning: 'neutral',
  locked: 'warning',
  closed: 'neutral',
  // report card
  submitted: 'info',
  published: 'success',
  // payment
  recorded: 'info',
  cleared: 'success',
  bounced: 'danger',
  refunded: 'neutral',
  // discount decision
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
}

export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const tone = TONE_BY_STATUS[status] ?? 'neutral'
  return <Badge tone={tone}>{children ?? status.replace(/_/g, ' ')}</Badge>
}
