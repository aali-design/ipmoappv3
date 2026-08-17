import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type {
  ExecutionStatus,
  StepResult,
  TestCase,
  TestExecution,
  TestRun,
} from "@/lib/types";
import { formatElapsed, pct, titleCase } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  ExecutionBadge,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { IconBug, IconPaperclip } from "@/components/ui";

export function RunExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: run, loading, error, reload } = useApi<TestRun>(
    () => api.get(`/runs/${id}`),
    [id],
  );
  const { data: executions, reload: reloadExecs } = useApi<TestExecution[]>(
    () => api.get(`/runs/${id}/executions`),
    [id],
  );

  const [currentId, setCurrentId] = useState<string | null>(null);
  const current = useMemo(
    () => executions?.find((e) => e.id === currentId) ?? executions?.[0] ?? null,
    [executions, currentId],
  );

  useEffect(() => {
    if (!currentId && executions && executions.length > 0) {
      setCurrentId(executions[0].id);
    }
  }, [executions, currentId]);

  const control = async (action: "start" | "pause" | "complete" | "abort") => {
    setBusy(true);
    try {
      await api.post(`/runs/${run?.id}/${action}`);
      success(`${titleCase(action)} requested`);
      reload();
    } catch (err) {
      toastError("Action failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Run" />
        <div className="content"><LoadingState /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Run" />
        <div className="content"><ErrorState error={error} onRetry={reload} /></div>
      </>
    );
  }
  if (!run) return null;

  const stats = run.stats;
  const total = stats?.total ?? executions?.length ?? 0;
  const executed = stats ? stats.total - stats.untested : 0;

  return (
    <>
      <PageHeader
        title={run.name}
        actions={
          <div className="flex items-center gap-2">
            {can("plan_runs") ? (
              <>
                {run.status === "planned" && (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => control("start")}>
                    Start
                  </Button>
                )}
                {run.status === "in_progress" && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => control("pause")}>
                    Pause
                  </Button>
                )}
                {run.status === "paused" && (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => control("start")}>
                    Resume
                  </Button>
                )}
                {(run.status === "in_progress" || run.status === "paused") && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => control("complete")}>
                    Complete
                  </Button>
                )}
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => navigate("/runs")}>
              Back
            </Button>
          </div>
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
          <div className="panel__body">
            <div className="flex items-center gap-3 mb-2">
              <span className={`badge badge--${run.status === "completed" ? "success" : run.status === "in_progress" ? "accent" : "neutral"}`}>
                {titleCase(run.status)}
              </span>
              <span className="text-sm text-muted">
                {executed} / {total} executed
              </span>
              <span className="ml-auto text-sm mono">{pct(total ? executed / total : 0, 0)}</span>
            </div>
            <div className="progress">
              <div
                className="progress__bar progress__bar--success"
                style={{ width: `${total ? (executed / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {executions && executions.length === 0 ? (
          <EmptyState title="No executions in this run" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: "var(--space-4)", alignItems: "start" }}>
            <div className="panel" style={{ maxHeight: "calc(100vh - 220px)", overflow: "auto" }}>
              <div className="panel__header">
                <h2 className="panel__title" style={{ fontSize: "var(--font-md)" }}>Cases</h2>
              </div>
              <div style={{ padding: "var(--space-2)" }}>
                {executions?.map((ex) => (
                  <button
                    key={ex.id}
                    className="nav-link"
                    style={{ width: "100%", justifyContent: "flex-start" }}
                    onClick={() => setCurrentId(ex.id)}
                  >
                    <span className="mono text-muted">{ex.caseRef ?? ex.testCaseId.slice(0, 8)}</span>
                    <span className="truncate flex-1">{ex.caseTitle ?? "—"}</span>
                    <ExecutionBadge status={ex.status} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              {current ? (
                <ExecutionDetail
                  key={current.id}
                  execution={current}
                  projectId={run.projectId}
                  canExecute={can("execute_tests")}
                  onChanged={() => {
                    reloadExecs();
                    reload();
                  }}
                  onNext={() => {
                    if (!executions) return;
                    const next = executions[executions.findIndex((e) => e.id === current.id) + 1];
                    if (next) setCurrentId(next.id);
                  }}
                  onCreatedDefect={(defectId) => navigate(`/defects?open=${defectId}`)}
                  onError={(m) => toastError("Save failed", m)}
                />
              ) : (
                <EmptyState title="Select a case" />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function ExecutionDetail({
  execution,
  projectId,
  canExecute,
  onChanged,
  onNext,
  onCreatedDefect,
  onError,
}: {
  execution: TestExecution;
  projectId: string;
  canExecute: boolean;
  onChanged: () => void;
  onNext: () => void;
  onCreatedDefect: (id: string) => void;
  onError: (m: string) => void;
}) {
  const { success } = useToast();
  const { data: testCase } = useApi<TestCase>(
    () => api.get(`/cases/${execution.testCaseId}`),
    [execution.testCaseId],
  );
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [comment, setComment] = useState(execution.comment ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [creatingDefect, setCreatingDefect] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startedRef = useRef(Date.now());

  useEffect(() => {
    if (seeded) return;
    if (execution.stepResults && execution.stepResults.length > 0) {
      setSteps(execution.stepResults);
      setSeeded(true);
    } else if (testCase?.steps && testCase.steps.length > 0) {
      setSteps(
        testCase.steps.map((s) => ({
          index: s.index,
          action: s.action,
          expected: s.expected,
          status: "untested" as ExecutionStatus,
        })),
      );
      setSeeded(true);
    }
  }, [execution.stepResults, testCase, seeded]);

  useEffect(() => {
    startedRef.current = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - startedRef.current), 1000);
    return () => clearInterval(t);
  }, [execution.id]);

  const setStepStatus = (i: number, status: ExecutionStatus) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, status } : st)));

  const save = async (status: ExecutionStatus) => {
    setSaving(true);
    try {
      await api.patch(`/executions/${execution.id}`, {
        status,
        comment,
        stepResults: steps,
        durationMs: elapsed,
      });
      success(`Marked ${titleCase(status)}`);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const createDefect = async () => {
    setCreatingDefect(true);
    try {
      const defect = await api.post<{ id: string }>(`/defects`, {
        projectId,
        fromExecutionIds: [execution.id],
      });
      success("Defect created from failure");
      onCreatedDefect(defect.id);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreatingDefect(false);
    }
  };

  // Keyboard shortcuts: P / F / B / →
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!canExecute) return;
      if (e.key === "p" || e.key === "P") save("passed");
      else if (e.key === "f" || e.key === "F") save("failed");
      else if (e.key === "b" || e.key === "B") save("blocked");
      else if (e.key === "ArrowRight") {
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, comment, elapsed, canExecute, execution.id]);

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entityType", "execution");
    form.append("entityId", execution.id);
    try {
      await api.post(`/attachments`, form);
      success("Attachment uploaded", file.name);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const statusClass = (s: ExecutionStatus) =>
    s === "passed" ? "text-success" : s === "failed" ? "text-danger" : s === "blocked" ? "text-warning" : "text-muted";

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            {execution.caseRef} — {execution.caseTitle || "Untitled"}
          </h2>
          <span className="ml-auto text-sm mono">{formatElapsed(elapsed)}</span>
        </div>
        <div className="panel__body">
          <div className="flex items-center gap-2 mb-3">
            <ExecutionBadge status={execution.status} />
            <span className="text-xs text-muted">
              attempt {execution.attempt}
            </span>
          </div>
          {testCase?.preconditions ? (
            <div className="panel" style={{ background: "var(--color-bgElevated)", marginBottom: "var(--space-3)" }}>
              <div className="panel__body">
                <span className="text-xs text-muted font-semibold">Preconditions</span>
                <p className="text-sm mt-1">{testCase.preconditions}</p>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-3"
                style={{
                  background: "var(--color-bgElevated)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-2) var(--space-3)",
                }}
              >
                <span className="mono text-muted" style={{ width: 22, paddingTop: 2 }}>{step.index}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{step.action}</div>
                  <div className="text-xs text-muted">Expected: {step.expected}</div>
                </div>
                {canExecute ? (
                  <div className="flex gap-1">
                    <StepButton active={step.status === "passed"} tone="success" label="Pass" onClick={() => setStepStatus(i, "passed")} />
                    <StepButton active={step.status === "failed"} tone="danger" label="Fail" onClick={() => setStepStatus(i, "failed")} />
                    <StepButton active={step.status === "blocked"} tone="warning" label="Block" onClick={() => setStepStatus(i, "blocked")} />
                  </div>
                ) : (
                  <span className={`text-sm ${statusClass(step.status)}`}>{titleCase(step.status)}</span>
                )}
              </div>
            ))}
            {steps.length === 0 ? (
              <p className="text-muted text-sm">No steps recorded for this case.</p>
            ) : null}
          </div>

          <div className="mt-3">
            <label className="field__label" htmlFor={`comment-${execution.id}`}>Comment</label>
            <textarea
              id={`comment-${execution.id}`}
              className="textarea"
              style={{ marginTop: "var(--space-1)" }}
              value={comment}
              disabled={!canExecute}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Notes about this execution…"
            />
          </div>

          <div
            className="flex items-center justify-center gap-3 mt-3"
            style={{
              border: `2px dashed ${dragging ? "var(--color-accent)" : "var(--color-borderStrong)"}`,
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-6)",
              background: dragging ? "var(--color-accentMuted)" : "transparent",
              transition: "background var(--transition-fast)",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
          >
            <IconPaperclip />
            <span className="text-sm text-secondary">Drop attachments here, or</span>
            <label className="btn btn--secondary btn--sm" style={{ cursor: "pointer" }}>
              Browse
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="panel__header" style={{ borderTop: "1px solid var(--color-border)", borderBottom: "none" }}>
          {execution.status === "failed" ? (
            <Button variant="danger" size="sm" icon={<IconBug />} loading={creatingDefect} onClick={createDefect}>
              Create defect from this failure
            </Button>
          ) : null}
          <div className="flex-1" />
          {canExecute ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={saving} onClick={() => save("passed")}>
                Pass (P)
              </Button>
              <Button size="sm" variant="danger" loading={saving} onClick={() => save("failed")}>
                Fail (F)
              </Button>
              <Button size="sm" variant="secondary" loading={saving} onClick={() => save("blocked")}>
                Block (B)
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepButton({
  active,
  tone,
  label,
  onClick,
}: {
  active: boolean;
  tone: "success" | "danger" | "warning";
  label: string;
  onClick: () => void;
}) {
  const colors: Record<string, { bg: string; border: string; fg: string }> = {
    success: { bg: "var(--color-successMuted)", border: "var(--color-success)", fg: "var(--color-successText)" },
    danger: { bg: "var(--color-dangerMuted)", border: "var(--color-danger)", fg: "var(--color-dangerText)" },
    warning: { bg: "var(--color-warningMuted)", border: "var(--color-warning)", fg: "var(--color-warningText)" },
  };
  const c = colors[tone];
  return (
    <button
      type="button"
      className="btn btn--xs"
      aria-pressed={active}
      aria-label={label}
      style={{
        background: active ? c.bg : "transparent",
        border: `1px solid ${active ? c.border : "var(--color-border)"}`,
        color: active ? c.fg : "var(--color-textSecondary)",
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
