import { useId } from "react";

export interface TabDef {
  id: string;
  label: string;
  badge?: number;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab${active === tab.id ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge != null ? (
            <span className="badge badge--neutral" style={{ marginLeft: 6 }}>
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const target = htmlFor ?? id;
  return (
    <div className="field">
      <label className="field__label" htmlFor={target}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {error ? <span className="field__error">{error}</span> : null}
      {help && !error ? <span className="field__help">{help}</span> : null}
    </div>
  );
}
