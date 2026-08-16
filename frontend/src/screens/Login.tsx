import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { homeForRole } from '../lib/nav'
import { errorMessage } from '../components/Toast'
import { Button, Field, Input } from '../components'
import './Login.css'

export function Login() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const from = (location.state as { from?: string } | null)?.from

  if (status === 'authenticated' && user) {
    return <Navigate to={from ?? homeForRole(user.role)} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email, password)
      const dest = from ?? (user ? homeForRole(user.role) : '/')
      navigate(dest, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand" aria-hidden="true">
        <span className="login-logo-mark">S</span>
        <span>Scholarion</span>
      </div>
      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">School management &amp; student information system</p>
        {error ? (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        ) : null}
        <Field label="Email" htmlFor="login-email" required>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="login-password" required>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" block loading={pending}>
          Sign in
        </Button>
      </form>
      <p className="login-footer muted">Access is role-scoped — you will see only your portal.</p>
    </div>
  )
}
