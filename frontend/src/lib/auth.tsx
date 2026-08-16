/**
 * Authentication + tenant context.
 *
 * - Boots from a persisted session (access/refresh tokens in localStorage).
 * - Loads `/auth/me` and `/school` to resolve the signed-in user, their scope
 *   (guardian/student child ids) and the tenant's currency/timezone/locale.
 * - `login`/`logout` mutate the shared session store so the apiClient interceptor
 *   and every screen stay in sync.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { sessionStore } from './apiClient'
import { scholarionApi } from './api'
import type { School, User } from './types'

export interface Scope {
  studentIds?: string[]
  staffId?: string
}

interface AuthContextValue {
  user: User | null
  scope: Scope
  school: School | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  currency: string
  timezone: string
  locale: string
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [scope, setScope] = useState<Scope>({})
  const [school, setSchool] = useState<School | null>(null)
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')

  const loadIdentity = useCallback(async () => {
    try {
      const me = await scholarionApi.me()
      setUser(me)
      setScope(me.scope ?? {})
      setStatus('authenticated')
    } catch {
      sessionStore.set(null)
      setUser(null)
      setScope({})
      setSchool(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    if (sessionStore.current) {
      void loadIdentity()
    } else {
      setStatus('unauthenticated')
    }
  }, [loadIdentity])

  // School metadata is best-effort: the `/school` endpoint is role-gated to
  // staff, so student/guardian sessions fall back to currency/timezone defaults.
  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    scholarionApi
      .getSchool()
      .then((s) => {
        if (!cancelled) setSchool(s)
      })
      .catch(() => {
        if (!cancelled) setSchool(null)
      })
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    return sessionStore.subscribe((session) => {
      if (!session) {
        setUser(null)
        setScope({})
        setSchool(null)
        setStatus('unauthenticated')
      }
    })
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await scholarionApi.login(email, password)
      sessionStore.set({ accessToken: res.accessToken, refreshToken: res.refreshToken })
      await loadIdentity()
    },
    [loadIdentity],
  )

  const logout = useCallback(async () => {
    await scholarionApi.logout()
    setUser(null)
    setScope({})
    setSchool(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const currency = school?.currency ?? 'USD'
    const timezone = school?.timezone ?? 'UTC'
    const locale = school?.locale ?? 'en-US'
    return { user, scope, school, status, currency, timezone, locale, login, logout }
  }, [user, scope, school, status, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
