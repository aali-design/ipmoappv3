import type { CSSProperties, ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <div className="card-title">{title}</div>
        {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`card-body ${className}`} style={style}>{children}</div>
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="card-footer">{children}</div>
}
