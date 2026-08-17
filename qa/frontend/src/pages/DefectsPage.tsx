import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api, buildQuery } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type {
  Defect,
  DefectPriority,
  DefectSeverity,
  DefectStatus,
} from "@/lib/types";
import { formatRelative, titleCase } from "@/lib/utils";
import {
  Button,
  DefectStatusBadge,
  EmptyState,
  ErrorState,
  ExecutionBadge,
  LoadingState,
  PageHeader,
  PriorityBadge,
  SeverityBadge,
} from "@/components/ui";
import { Drawer, Field, Tabs } from "@/components/ui";

const STATUS_COLUMNS: DefectStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "verified",
  "closed",
];

export function DefectsPage() {
  const projectId = useCurrentProjectId();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"board" | "table">("board");
  const [severity, setSeverity] = useState<DefectSeverity | "">("");
  const [priority, setPriority] = useState<DefectPriority | "">("");
  const [q, setQ] = useState("");

  const { data, loading, error, reload } = useApi<Defect[]>(
    () =>
      api.get(
        `/projects/${projectId}/defects${buildQuery({ severity, priority, q })}`,
      ),
    [projectId, severity, priority, q],
  );

  const openId = searchParams.get("open");
  const [selected, setSelected] = useState<Defect | null>(null);
  const { data: detail, loading: detailLoading, reload: reloadDetail } =
    useApi<Defect>(() => (openId ? api.get(`/defects/${openId}`) : Promise.resolve(null as unknown as Defect)), [openId]);

  useEffect(() => {
    setSelected(detail ?? null);
  }, [detail]);

  const closeDrawer = () => {
    searchParams.delete("open");
    setSearchParams(searchParams, { replace: true });
    setSelected(null);
  };

  const move = async (defect: Defect, to: DefectStatus) => {
    try {
      await api.patch(`/defects/${defect.id}`, { status: to });
      success(`${defect.ref} → ${titleCase(to)}`);
      reload();
    } catch (err) {
      toastError("Transition rejected", (err as Error).message);
      reload();
    }
  };

  const openDefect = (id: string) => {
    setSearchParams({ open: id }, { replace: false });
  };

  return (
    <>
      <PageHeader
        title="Defects"
        actions={
          <div className="flex items-center gap-2">
            <select
              className="select"
              style={{ width: 130 }}
              value={severity}
              aria-label="Filter severity"
              onChange={(e) => setSeverity(e.target.value as DefectSeverity)}
            >
              <option value="">All severities</option>
              {["trivial", "minor", "major", "critical", "blocker"].map((s) => (
                <option key={s} value={s}>{titleCase(s)}</option>
              ))}
            </select>
            <select
              className="select"
              style={{ width: 130 }}
              value={priority}
              aria-label="Filter priority"
              onChange={(e) => setPriority(e.target.value as DefectPriority)}
            >
              <option value="">All priorities</option>
              {["low", "medium", "high", "urgent"].map((p) => (
                <option key={p} value={p}>{titleCase(p)}</option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search defects"
            />
          </div>
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Tabs
            tabs={[
              { id: "board", label: "Board" },
              { id: "table", label: "Table" },
            ]}
            active={view}
            onChange={(v) => setView(v as "board" | "table")}
          />
        </div>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data && data.length === 0 ? (
          <EmptyState title="No defects" hint="Defects appear here as failures are triaged." />
        ) : null}
        {data && data.length > 0 && view === "board" ? (
          <KanbanBoard defects={data} onMove={move} canTriage={can("triage_defects")} onOpen={openDefect} />
        ) : null}
        {data && data.length > 0 && view === "table" ? (
          <DefectsTable defects={data} onOpen={openDefect} />
        ) : null}
      </div>

      <DefectDrawer
        defect={selected}
        loading={detailLoading}
        onClose={closeDrawer}
        onChanged={() => {
          reloadDetail();
          reload();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function KanbanBoard({
  defects,
  onMove,
  canTriage,
  onOpen,
}: {
  defects: Defect[];
  onMove: (d: Defect, to: DefectStatus) => void;
  canTriage: boolean;
  onOpen: (id: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="flex gap-3" style={{ overflowX: "auto", alignItems: "flex-start" }}>
      {STATUS_COLUMNS.map((status) => {
        const items = defects.filter((d) => d.status === status);
        return (
          <div
            key={status}
            className="panel"
            style={{ minWidth: 220, flex: 1 }}
            onDragOver={(e) => {
              if (canTriage) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const defect = defects.find((d) => d.id === id);
              if (defect && defect.status !== status) onMove(defect, status);
              setDragId(null);
            }}
          >
            <div className="panel__header">
              <h3 className="panel__title" style={{ fontSize: "var(--font-md)" }}>
                {titleCase(status)}
              </h3>
              <span className="badge badge--neutral">{items.length}</span>
            </div>
            <div className="panel__body space-y-2" style={{ padding: "var(--space-3)" }}>
              {items.map((d) => (
                <div
                  key={d.id}
                  draggable={canTriage}
                  onDragStart={(e) => {
                    setDragId(d.id);
                    e.dataTransfer.setData("text/plain", d.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(d.id)}
                  style={{
                    background: "var(--color-bgElevated)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-2) var(--space-3)",
                    cursor: canTriage ? "grab" : "pointer",
                    opacity: dragId === d.id ? 0.5 : 1,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="mono text-xs text-muted">{d.ref}</span>
                    <span className="ml-auto"><SeverityBadge severity={d.severity} /></span>
                  </div>
                  <div className="text-sm font-medium truncate mt-1">{d.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <PriorityBadge priority={d.priority} />
                    {d.escapedToProd ? <span className="badge badge--danger">escaped</span> : null}
                  </div>
                </div>
              ))}
              {items.length === 0 ? (
                <p className="text-xs text-muted" style={{ textAlign: "center", padding: "var(--space-4) 0" }}>
                  Drop here
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DefectsTable({
  defects,
  onOpen,
}: {
  defects: Defect[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {defects.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
              <td className="mono">{d.ref}</td>
              <td className="truncate" style={{ maxWidth: 400 }}>{d.title}</td>
              <td><SeverityBadge severity={d.severity} /></td>
              <td><PriorityBadge priority={d.priority} /></td>
              <td><DefectStatusBadge status={d.status} /></td>
              <td className="text-muted">{formatRelative(d.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DefectDrawer({
  defect,
  loading,
  onClose,
  onChanged,
}: {
  defect: Defect | null;
  loading: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [nextStatus, setNextStatus] = useState<DefectStatus | "">("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (defect) setNextStatus(defect.status);
  }, [defect?.id, defect?.status]);

  if (!defect) return null;

  const transition = async () => {
    if (!nextStatus || nextStatus === defect.status) return;
    setBusy(true);
    try {
      await api.patch(`/defects/${defect.id}`, { status: nextStatus });
      success("Status updated");
      onChanged();
    } catch (err) {
      toastError("Transition rejected", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api.post(`/defects/${defect.id}/comments`, { comment });
      success("Comment added");
      setComment("");
      onChanged();
    } catch (err) {
      toastError("Failed to comment", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={!!defect}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="mono">{defect.ref}</span>
          <DefectStatusBadge status={defect.status} />
        </span>
      }
      headerExtra={<SeverityBadge severity={defect.severity} />}
    >
      {loading ? <LoadingState /> : (
        <div className="space-y-4">
          <div>
            <h2 style={{ fontSize: "var(--font-lg)" }}>{defect.title}</h2>
            <p className="text-sm text-secondary mt-2">{defect.description ?? "No description"}</p>
          </div>

          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Meta label="Priority"><PriorityBadge priority={defect.priority} /></Meta>
            <Meta label="Severity"><SeverityBadge severity={defect.severity} /></Meta>
            <Meta label="Found in build"><span className="mono">{defect.foundInBuildId ?? "—"}</span></Meta>
            <Meta label="Reporter"><span>{defect.reporterEmail ?? "—"}</span></Meta>
            <Meta label="Assignee"><span>{defect.assigneeEmail ?? "—"}</span></Meta>
            <Meta label="SLA due"><span>{formatRelative(defect.slaDueAt)}</span></Meta>
          </div>

          {can("triage_defects") ? (
            <div className="panel">
              <div className="panel__body space-y-2">
                <Field label="Transition status">
                  <select
                    className="select"
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as DefectStatus)}
                  >
                    {(["new", "triaged", "in_progress", "resolved", "verified", "closed", "reopened", "wont_fix", "duplicate"] as DefectStatus[]).map((s) => (
                      <option key={s} value={s}>{titleCase(s)}</option>
                    ))}
                  </select>
                </Field>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={!nextStatus || nextStatus === defect.status}
                  onClick={transition}
                >
                  Apply transition
                </Button>
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel__header">
              <h3 className="panel__title">History</h3>
            </div>
            <div className="panel__body space-y-3">
              {defect.events && defect.events.length === 0 ? (
                <p className="text-muted text-sm">No events recorded.</p>
              ) : null}
              {defect.events?.map((ev) => (
                <div key={ev.id} className="flex gap-3">
                  <span className="text-muted text-xs mono" style={{ width: 120, flexShrink: 0 }}>
                    {formatRelative(ev.createdAt)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm">
                      {ev.fromStatus ? (
                        <span>
                          <span className="text-muted">{titleCase(ev.fromStatus)}</span> →{" "}
                          <span className="font-semibold">{titleCase(ev.toStatus)}</span>
                        </span>
                      ) : (
                        <span className="font-semibold">{titleCase(ev.toStatus)}</span>
                      )}
                      {ev.actorEmail ? <span className="text-muted"> · {ev.actorEmail}</span> : null}
                    </div>
                    {ev.comment ? <p className="text-sm text-secondary mt-1">{ev.comment}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <h3 className="panel__title">Linked executions</h3>
            </div>
            <div className="panel__body">
              {defect.linkedExecutions && defect.linkedExecutions.length === 0 ? (
                <p className="text-muted text-sm">No linked executions.</p>
              ) : null}
              {defect.linkedExecutions?.map((ex) => (
                <div key={ex.executionId} className="flex items-center gap-2 py-1">
                  <span className="mono text-xs text-muted">{ex.caseRef ?? ex.testCaseId.slice(0, 8)}</span>
                  <ExecutionBadge status={ex.status} />
                  <span className="text-muted text-xs ml-auto">{formatRelative(ex.executedAt)}</span>
                </div>
              ))}
            </div>
          </div>

          {can("comment_defects") ? (
            <div className="panel">
              <div className="panel__body space-y-2">
                <Field label="Add comment">
                  <textarea
                    className="textarea"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment…"
                  />
                </Field>
                <Button variant="secondary" size="sm" loading={busy} disabled={!comment.trim()} onClick={addComment}>
                  Comment
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm mt-1">{children}</div>
    </div>
  );
}
