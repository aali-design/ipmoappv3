import { useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type { FailureCluster, TestExecution, TestRun } from "@/lib/types";
import { formatRelative } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { IconBug } from "@/components/ui";

export function TriagePage() {
  const projectId = useCurrentProjectId();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [runId, setRunId] = useState("");

  const { data: runs } = useApi<TestRun[]>(
    () => api.get(`/projects/${projectId}/runs`),
    [projectId],
  );
  const { data: executions, loading, error, reload } = useApi<TestExecution[]>(
    () =>
      runId
        ? api.get(`/runs/${runId}/executions`)
        : Promise.resolve([] as TestExecution[]),
    [runId],
  );

  const clusters = useMemo<FailureCluster[]>(() => {
    const failed = (executions ?? []).filter((e) => e.status === "failed");
    const map = new Map<string, FailureCluster>();
    for (const ex of failed) {
      const sig = ex.failureSignature ?? "unknown";
      let c = map.get(sig);
      if (!c) {
        c = {
          signature: sig,
          count: 0,
          firstSeenAt: ex.executedAt ?? "",
          lastSeenAt: ex.executedAt ?? "",
          sampleError:
            ex.stepResults?.find((s) => s.status === "failed")?.comment ??
            ex.comment ??
            "No message captured",
          executionIds: [],
          caseRefs: [],
        };
        map.set(sig, c);
      }
      c.count += 1;
      c.executionIds.push(ex.id);
      if (ex.caseRef) c.caseRefs.push(ex.caseRef);
      if (ex.executedAt && ex.executedAt < c.firstSeenAt) c.firstSeenAt = ex.executedAt;
      if (ex.executedAt && ex.executedAt > c.lastSeenAt) c.lastSeenAt = ex.executedAt;
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [executions]);

  const createDefect = async (cluster: FailureCluster) => {
    try {
      const defect = await api.post<{ ref: string }>(`/defects`, {
        projectId,
        fromExecutionIds: cluster.executionIds,
      });
      success("Defect created", `${defect.ref} linked ${cluster.executionIds.length} execution(s)`);
      reload();
    } catch (err) {
      toastError("Failed to create defect", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Triage"
        actions={
          <select
            className="select"
            style={{ width: 280 }}
            value={runId}
            aria-label="Select run"
            onChange={(e) => setRunId(e.target.value)}
          >
            <option value="">Select a run…</option>
            {runs?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.buildLabel ?? "no build"}
              </option>
            ))}
          </select>
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        {!runId ? (
          <EmptyState title="Select a run" hint="Failures are clustered by failure signature across a run." />
        ) : null}
        {runId && loading ? <LoadingState /> : null}
        {runId && error ? <ErrorState error={error} onRetry={reload} /> : null}
        {runId && clusters.length === 0 && !loading && !error ? (
          <EmptyState title="No failures to triage" />
        ) : null}
        {runId && clusters.length > 0 ? (
          <div className="space-y-3">
            {clusters.map((c) => (
              <div className="panel" key={c.signature}>
                <div className="panel__header">
                  <span className="badge badge--danger">{c.count} failures</span>
                  <code className="mono text-xs text-muted flex-1 truncate" title={c.signature}>
                    {c.signature}
                  </code>
                  {can("triage_defects") ? (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<IconBug />}
                      onClick={() => createDefect(c)}
                    >
                      Create one defect
                    </Button>
                  ) : null}
                </div>
                <div className="panel__body">
                  <div className="flex gap-4 text-xs text-muted mb-2">
                    <span>First seen: {formatRelative(c.firstSeenAt)}</span>
                    <span>Last seen: {formatRelative(c.lastSeenAt)}</span>
                    <span>{c.caseRefs.length} distinct case(s)</span>
                  </div>
                  <pre
                    className="mono text-xs"
                    style={{
                      background: "var(--color-bgElevated)",
                      padding: "var(--space-3)",
                      borderRadius: "var(--radius-md)",
                      whiteSpace: "pre-wrap",
                      color: "var(--color-dangerText)",
                    }}
                  >
                    {c.sampleError}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
