import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastTone = 'default' | 'success' | 'danger'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, tone: ToastTone = 'default') => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone !== 'default' ? `toast-${t.tone}` : ''}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

/** Convenience wrapper for fetch-then-toast success/failure. */
export function useAsyncAction() {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
      setPending(true)
      try {
        await fn()
        toast(`${label} saved`)
        return true
      } catch (err) {
        toast(errorMessage(err), 'danger')
        return false
      } finally {
        setPending(false)
      }
    },
    [toast],
  )

  return { run, pending }
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return 'Request failed'
}

/** Best-effort resolve of error text with optional stable code from an ApiRequestError. */
export function apiErrorMessage(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string }
    return { code: e.code ?? 'UnknownError', message: e.message ?? 'Request failed' }
  }
  return { code: 'UnknownError', message: 'Request failed' }
}
