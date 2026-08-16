import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders children with default primary styling', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('btn', 'btn-primary')
  })

  it('applies variant and size classes', () => {
    render(
      <Button variant="danger" size="lg">
        Delete
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger', 'btn-lg')
  })

  it('invokes the click handler', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Click me' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled while loading', () => {
    render(<Button loading>Submit</Button>)
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })
})
