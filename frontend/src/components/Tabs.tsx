export interface TabDef {
  id: string
  label: string
}

export function Tabs({ tabs, active, onChange, ariaLabel }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; ariaLabel?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`tab ${t.id === active ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
