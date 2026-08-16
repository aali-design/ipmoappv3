import { useNavigate } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import type { TestRun } from "@/lib/types";
import { formatRelative, pct, titleCase } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { Badge } from "@/components/ui";
import { IconPlay } from "@/components/ui";

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent" | "info"> = {
  planned: "neutral",
  in_progress: "accent",
  paused: "warning",
  completed: "success",
  aborted: "danger",
};

export function RunsPage() {
  const projectId = useCurrentProjectId();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi<TestRun[]>(
    () => api.get(`/projects/${projectId}/runs`),
    [projectId],
  );

  return (
    <>
      <PageHeader
        title="Test Runs"
        actions={
          can("plan_runs") ? (
            <Button variant="primary" icon={<IconPlay />} onClick={() => navigate("/runs/new")}>
              New run
            </Button>
          ) : null
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data && data.length === 0 ? (
          <EmptyState
            title="No runs"
            hint="Create a run from a suite, filter, or explicit case list."
            action={
              can("plan_runs") ? (
                <Button variant="primary" onClick={() => navigate("/runs/new")}>
                  New run
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {data && data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Build</th>
                  <th>Environment</th>
                  <th>Progress</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {data.map((run) => {
                  const stats = run.stats_json;
                  const executed = stats
                    ? stats.total - stats.untested
                    : 0;
                  const rate = stats && stats.total > 0 ? executed / stats.total : 0;
                  return (
                    <tr key={run.id} className="clickable" onClick={() => navigate(`/runs/${run.id}`)}>
                      <td className="font-semibold">{run.name}</td>
                      <td>
                        <Badge tone={RUN_TONE[run.status] ?? "neutral"}>
                          {titleCase(run.status)}
                        </Badge>
                      </td>
                      <td>{titleCase(run.source)}</td>
                      <td className="mono">{run.build?.version_label ?? "—"}</td>
                      <td>{run.environment?.name ?? "—"}</td>
                      <td style={{ minWidth: 160 }}>
                        {stats ? (
                          <div className="flex items-center gap-2">
                            <div className="progress flex-1">
                              <div
                                className="progress__bar progress__bar--success"
                                style={{ width: `${rate * 100}%` }}
                              />
                            </div>
                            <span className="text-xs mono">{pct(rate, 0)}</span>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-muted">{formatRelative(run.started_at ?? run.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
