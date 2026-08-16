import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the ipmo shell and sign-in form', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ipmo')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Sign in')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
