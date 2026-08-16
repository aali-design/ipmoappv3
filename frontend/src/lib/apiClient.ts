import type { ApiError } from './types'

/**
 * Typed API client with a JWT interceptor.
 *
 * - Attaches the Bearer access token to every request.
 * - On 401, tries a single `/auth/refresh`; if that succeeds it retries the
 *   original request once. If refresh fails (or is itself a 401), it clears
 *   the session and notifies subscribers so the router can redirect to login.
 * - Concurrent 401s share one in-flight refresh.
 */

const ACCESS_KEY = 'scholarion.accessToken'
const REFRESH_KEY = 'scholarion.refreshToken'
const BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string) || '/api'

export class ApiRequestError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface SessionData {
  accessToken: string
  refreshToken: string
}

export type SessionListener = (session: SessionData | null) => void

class SessionStore {
  private session: SessionData | null = null
  private listeners = new Set<SessionListener>()

  constructor() {
    const access = localStorage.getItem(ACCESS_KEY)
    const refresh = localStorage.getItem(REFRESH_KEY)
    if (access && refresh) {
      this.session = { accessToken: access, refreshToken: refresh }
    }
  }

  get current(): SessionData | null {
    return this.session
  }

  set(session: SessionData | null): void {
    this.session = session
    if (session) {
      localStorage.setItem(ACCESS_KEY, session.accessToken)
      localStorage.setItem(REFRESH_KEY, session.refreshToken)
    } else {
      localStorage.removeItem(ACCESS_KEY)
      localStorage.removeItem(REFRESH_KEY)
    }
    this.listeners.forEach((l) => l(session))
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const sessionStore = new SessionStore()

let refreshPromise: Promise<boolean> | null = null

async function requestRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefresh()
    .catch(() => false)
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

async function doRefresh(): Promise<boolean> {
  const refresh = sessionStore.current?.refreshToken
  if (!refresh) return false
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    })
    if (!res.ok) {
      sessionStore.set(null)
      return false
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string }
    sessionStore.set({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    return true
  } catch {
    sessionStore.set(null)
    return false
  }
}

export async function readErrorResponse(res: Response): Promise<ApiRequestError> {
  let payload: ApiError | undefined
  try {
    const body = (await res.json()) as ApiError
    if (body && typeof body.message === 'string') payload = body
  } catch {
    /* non-JSON body */
  }
  return new ApiRequestError(
    payload?.message ?? `Request failed (${res.status})`,
    res.status,
    payload?.error ?? 'UnknownError',
    payload?.details,
  )
}

export interface RequestOptions {
  /** Query params to append. Undefined values are omitted. */
  params?: Record<string, string | number | boolean | null | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface BodyOptions<T> extends RequestOptions {
  body?: T
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions & { body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin)
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const doFetch = (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    }
    const token = sessionStore.current?.accessToken
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
    return fetch(url.toString(), {
      method,
      headers,
      body: options.body instanceof FormData ? options.body : options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  }

  let res = await doFetch()

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await requestRefresh()
    if (refreshed) {
      res = await doFetch()
    } else {
      throw new ApiRequestError('Session expired. Please sign in again.', 401, 'Unauthorized')
    }
  }

  if (!res.ok) {
    throw await readErrorResponse(res)
  }

  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  delete<T>(path: string, options?: RequestOptions): Promise<T>
}

export const api: ApiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
}

/** Domain-tagged API methods for auth, kept separate for clarity. */
export const authApi = {
  login: async (email: string, password: string) => {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: never }>(
      '/auth/login',
      { email, password },
      { headers: {} },
    )
    return data
  },
  logout: async () => {
    try {
      await api.post('/auth/logout', { refreshToken: sessionStore.current?.refreshToken })
    } catch {
      /* ignore network failures on logout */
    } finally {
      sessionStore.set(null)
    }
  },
  me: () => api.get<never>('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', body),
}

export function clearSession(): void {
  sessionStore.set(null)
}

export default api