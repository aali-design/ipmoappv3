import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the ipmo welcome', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ipmo')
    expect(screen.getByText('Welcome to ipmo.')).toBeInTheDocument()
  })
})