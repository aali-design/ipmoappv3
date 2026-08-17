import { useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { chart } from "@/theme";
import type { RequirementStatus_Matrix, TraceabilityMatrix } from "@/lib/types";
import { downloadText, pct, toCsv } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { IconDownload } from "@/components/ui";

const STATUS_COLOR: Record<string, string> = {
  covered_passing: chart.pass,
  covered_failing: chart.fail,
  covered_untested: chart.blocked,
  uncovered: chart.untested,
};

const STATUS_LABEL: Record<string, string> = {
  covered_passing: "Passing",
  covered_failing: "Failing",
  covered_untested: "Untested",
  uncovered: "Uncovered",
};

export function TraceabilityPage() {
  const projectId = useCurrentProjectId();
  const [gapsOnly, setGapsOnly] = useState(false);

  const { data, loading, error, reload } = useApi<TraceabilityMatrix>(
    () => api.get(`/projects/${projectId}/traceability`),
    [projectId],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.matrix.filter((r) => {
      if (!gapsOnly) return true;
      return r.status === "uncovered";
    });
  }, [data, gapsOnly]);

  const exportCsv = () => {
    if (!data) return;
    const rows: Array<Array<string | number>> = [
      ["Requirement", "Title", "Criticality", "Status", "Linked cases"],
      ...data.matrix.map((r) => [
        r.requirement.ref,
        r.requirement.title,
        r.requirement.criticality,
        STATUS_LABEL[r.status] ?? r.status,
        r.cases.map((c) => c.caseRef).join("; "),
      ]),
    ];
    downloadText("traceability.csv", toCsv(rows));
  };

  return (
    <>
      <PageHeader
        title="Traceability Matrix"
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox"
                checked={gapsOnly}
                onChange={(e) => setGapsOnly(e.target.checked)}
              />
              Gaps only
            </label>
            <Button variant="secondary" size="sm" icon={<IconDownload />} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data && data.matrix.length === 0 ? (
          <EmptyState title="No requirements" hint="Create requirements to trace test coverage." />
        ) : null}
        {data && data.matrix.length > 0 ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="badge badge--accent">
                {pct(data.coverage, 0)} coverage
              </span>
              <span className="text-sm text-muted">
                {data.gaps.length} uncovered requirement(s)
              </span>
              <div className="ml-auto flex items-center gap-2">
                {Object.entries(STATUS_LABEL).map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1 text-xs text-muted">
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: STATUS_COLOR[key],
                        display: "inline-block",
                      }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Criticality</th>
                    <th>Status</th>
                    <th>Linked cases</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const status = (r.status as RequirementStatus_Matrix) ?? "uncovered";
                    return (
                      <tr key={r.requirement.id}>
                        <td>
                          <div className="mono text-xs text-muted">{r.requirement.ref}</div>
                          <div>{r.requirement.title}</div>
                        </td>
                        <td>
                          <span className="badge badge--neutral">{r.requirement.criticality}</span>
                        </td>
                        <td>
                          <span className="flex items-center gap-2">
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                background: STATUS_COLOR[status],
                                display: "inline-block",
                              }}
                            />
                            {STATUS_LABEL[status]}
                          </span>
                        </td>
                        <td>
                          <span className="mono text-xs text-muted">
                            {r.cases.map((c) => c.caseRef).join(", ") || "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
