import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, StatusBadge } from './Badge'

describe('Badge', () => {
  it('renders children with the neutral tone by default', () => {
    render(<Badge>Hello</Badge>)
    expect(screen.getByText('Hello')).toHaveClass('badge', 'badge-neutral')
  })

  it('applies an explicit tone', () => {
    render(<Badge tone="danger">Overdue</Badge>)
    expect(screen.getByText('Overdue')).toHaveClass('badge', 'badge-danger')
  })
})

describe('StatusBadge', () => {
  it('maps a known status to its tone', () => {
    render(<StatusBadge status="overdue" />)
    expect(screen.getByText('overdue')).toHaveClass('badge-danger')
  })

  it('renders underscore statuses as spaced text', () => {
    render(<StatusBadge status="partially_paid" />)
    expect(screen.getByText('partially paid')).toHaveClass('badge-warning')
  })

  it('falls back to neutral for unknown statuses', () => {
    render(<StatusBadge status="mystery" />)
    expect(screen.getByText('mystery')).toHaveClass('badge-neutral')
  })
})
