import { Link } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { chart } from "@/theme";
import type { Metrics } from "@/lib/types";
import { formatRelative, pct } from "@/lib/utils";
import { DonutChart, TrendChart, BurnDownChart } from "@/components/charts";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SeverityBadge,
} from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { DefectSeverity } from "@/lib/types";

export function DashboardPage() {
  const projectId = useCurrentProjectId();
  const { data, loading, error, reload } = useApi<Metrics>(
    () => api.get(`/projects/${projectId}/metrics`),
    [projectId],
  );

  return (
    <>
      <PageHeader title="Project Dashboard" />
      <div className="content">
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data ? (
          <div className="space-y-4">
            <div className="card-grid">
              <div className="panel stat">
                <div className="stat__label">Requirement coverage</div>
                <div className="stat__value">{pct(data.coveragePct, 0)}</div>
                <div className="stat__delta text-muted">
                  {data.coverageGaps.length} uncovered requirement
                  {data.coverageGaps.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="panel stat">
                <div className="stat__label">Defect density</div>
                <div className="stat__value">
                  {data.defectDensity.toFixed(2)}
                </div>
                <div className="stat__delta text-muted">defects ÷ executed</div>
              </div>
              <div className="panel stat">
                <div className="stat__label">Mean time to detect</div>
                <div className="stat__value">
                  {data.meanTimeToDetectHours.toFixed(1)}h
                </div>
              </div>
              <div className="panel stat">
                <div className="stat__label">Reopen rate</div>
                <div className="stat__value">{pct(data.reopenRate, 1)}</div>
                <div className="stat__delta text-muted">
                  escape {pct(data.escapeRate, 1)}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                gap: "var(--space-4)",
              }}
            >
              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Pass-rate trend by build</h2>
                </div>
                <div className="panel__body">
                  {data.passRateTrend.length === 0 ? (
                    <EmptyState title="No builds yet" />
                  ) : (
                    <TrendChart
                      points={data.passRateTrend.map((t) => ({
                        label: t.build_label,
                        value: t.pass_rate * 100,
                      }))}
                    />
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Open defects by severity</h2>
                </div>
                <div className="panel__body">
                  <SeverityBars
                    counts={data.openDefectsBySeverity as Record<string, number>}
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: "var(--space-4)",
              }}
            >
              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Coverage & gaps</h2>
                </div>
                <div className="panel__body flex items-center gap-4">
                  <DonutChart
                    segments={[
                      {
                        value: data.coveragePct * 100,
                        color: chart.pass,
                        label: "Covered",
                      },
                      {
                        value: (1 - data.coveragePct) * 100,
                        color: chart.untested,
                        label: "Uncovered",
                      },
                    ]}
                    label={pct(data.coveragePct, 0)}
                    sublabel="covered"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    {data.coverageGaps.length === 0 ? (
                      <p className="text-muted text-sm">All requirements covered.</p>
                    ) : (
                      data.coverageGaps.map((gap) => (
                        <div key={gap.ref} className="flex items-center gap-2">
                          <span className="mono">{gap.ref}</span>
                          <span className="truncate flex-1">{gap.title}</span>
                          <Badge tone="warning">{gap.criticality}</Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Active run burn-down</h2>
                </div>
                <div className="panel__body">
                  {data.burnDown.length === 0 ? (
                    <EmptyState title="No active run" />
                  ) : (
                    <BurnDownChart
                      points={data.burnDown.map((b) => ({ label: b.day, value: b.remaining }))}
                    />
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: "var(--space-4)",
              }}
            >
              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Flakiest cases</h2>
                  <Link className="ml-auto text-sm" to="/flaky">
                    View queue →
                  </Link>
                </div>
                <div className="panel__body">
                  {data.flakiestCases.length === 0 ? (
                    <EmptyState title="No flaky cases" />
                  ) : (
                    <table className="table table--dense">
                      <thead>
                        <tr>
                          <th>Case</th>
                          <th>Title</th>
                          <th>Flake score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.flakiestCases.map((c) => (
                          <tr key={c.test_case_ref}>
                            <td className="mono">{c.test_case_ref}</td>
                            <td className="truncate">{c.title}</td>
                            <td>
                              <Badge
                                tone={
                                  c.flake_score > 0.2
                                    ? "danger"
                                    : c.flake_score >= 0.05
                                      ? "warning"
                                      : "success"
                                }
                              >
                                {c.flake_score.toFixed(3)}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Recent activity</h2>
                </div>
                <div className="panel__body">
                  {data.recentActivity.length === 0 ? (
                    <EmptyState title="No recent activity" />
                  ) : (
                    <ul className="space-y-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {data.recentActivity.map((a) => (
                        <li key={a.id} className="flex items-center gap-3">
                          <span className="badge badge--info">{a.kind}</span>
                          <span className="truncate flex-1">{a.summary}</span>
                          <span className="text-muted text-xs">
                            {formatRelative(a.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SeverityBars({ counts }: { counts: Record<string, number> }) {
  const order: DefectSeverity[] = [
    "blocker",
    "critical",
    "major",
    "minor",
    "trivial",
  ];
  const max = Math.max(1, ...order.map((s) => counts[s] ?? 0));
  return (
    <div className="space-y-2">
      {order.map((sev) => {
        const count = counts[sev] ?? 0;
        return (
          <div key={sev} className="flex items-center gap-3">
            <span style={{ width: 64 }}>
              <SeverityBadge severity={sev} />
            </span>
            <div className="progress flex-1" style={{ height: 10 }}>
              <div
                className="progress__bar"
                style={{ width: `${(count / max) * 100}%`, background: "var(--color-danger)" }}
              />
            </div>
            <span className="mono" style={{ width: 24, textAlign: "right" }}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
