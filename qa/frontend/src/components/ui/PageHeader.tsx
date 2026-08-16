import type { ReactNode } from "react";

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="topbar">
      <h1 className="topbar__title">{title}</h1>
      <div className="topbar__spacer" />
      {actions}
    </div>
  );
}
