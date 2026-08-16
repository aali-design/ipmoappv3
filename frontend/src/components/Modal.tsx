import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  labelledBy?: string
}

export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const titleId = useRef(`modal-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
      >
        <div className="modal-header">
          <h2 id={titleId.current} style={{ fontSize: 'var(--sch-font-size-xl)', fontWeight: 'var(--sch-font-weight-semibold)' }}>
            {title}
          </h2>
          <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close dialog">
            &times;
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
