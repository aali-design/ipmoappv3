import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorMessage } from '../components/Toast'

export interface AsyncData<T> {
  data: T | null
  loading: boolean
  error: { code: string; message: string } | null
  refetch: () => void
}

/**
 * Minimal data-fetching hook: loads `fetcher` once, tracks loading/error, and
 * exposes `refetch` for manual refresh. No caching — every screen reads the
 * real API on mount.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcherRef
      .current()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(apiErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, refetch }
}
