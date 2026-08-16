import type { ReactNode } from "react";
import type { ApiRequestError } from "@/lib/apiClient";
import { Button } from "./Button";
import { IconAlert, IconInbox } from "./Icons";

export function Spinner({ large }: { large?: boolean }) {
  return (
    <span
      className={`spinner${large ? " spinner--lg" : ""}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <Spinner large />
      <p className="state__hint">{label}</p>
    </div>
  );
}

export function Skeleton({ height = 16 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={i % 3 === 0 ? 28 : 18} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state" role="status">
      <IconInbox width={40} height={40} className="state__icon" />
      <p className="state__title">{title}</p>
      {hint ? <p className="state__hint">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiRequestError | null;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <IconAlert width={40} height={40} className="state__icon" />
      <p className="state__title">
        {error?.status ? `Error ${error.status}` : "Something went wrong"}
      </p>
      <p className="state__hint">
        {error?.message ?? "The request failed. Please try again."}
      </p>
      {onRetry ? (
        <div className="mt-2">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
