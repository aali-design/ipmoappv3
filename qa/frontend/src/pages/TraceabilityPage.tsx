import { useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import { api, buildQuery } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { chart } from "@/theme";
import type { Build, TraceabilityMatrix } from "@/lib/types";
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
  const [buildId, setBuildId] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);

  const { data: builds } = useApi<Build[]>(
    () => api.get<Build[]>(`/projects/${projectId}/builds`).catch(() => [] as Build[]),
    [projectId],
  );
  const { data, loading, error, reload } = useApi<TraceabilityMatrix>(
    () =>
      api.get(
        `/projects/${projectId}/traceability${buildQuery({ buildId: buildId || undefined })}`,
      ),
    [projectId, buildId],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.requirements.filter((r) => {
      if (!gapsOnly) return true;
      return data.cells[r.id]?.status === "uncovered";
    });
  }, [data, gapsOnly]);

  const exportCsv = () => {
    if (!data) return;
    const rows: Array<Array<string | number>> = [
      ["Requirement", "Title", "Criticality", "Status", "Linked cases"],
      ...data.requirements.map((r) => {
        const cell = data.cells[r.id];
        return [
          r.ref,
          r.title,
          r.criticality,
          cell ? STATUS_LABEL[cell.status] : "Uncovered",
          (cell?.case_refs ?? []).join("; "),
        ];
      }),
    ];
    downloadText("traceability.csv", toCsv(rows));
  };

  return (
    <>
      <PageHeader
        title="Traceability Matrix"
        actions={
          <div className="flex items-center gap-2">
            <select
              className="select"
              style={{ width: 220 }}
              value={buildId}
              aria-label="Select build"
              onChange={(e) => setBuildId(e.target.value)}
            >
              <option value="">Latest build</option>
              {builds?.map((b) => (
                <option key={b.id} value={b.id}>{b.version_label}</option>
              ))}
            </select>
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
        {data && data.requirements.length === 0 ? (
          <EmptyState title="No requirements" hint="Create requirements to trace test coverage." />
        ) : null}
        {data && data.requirements.length > 0 ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="badge badge--accent">
                {pct(data.coveragePct, 0)} coverage
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
                    const cell = data.cells[r.id];
                    const status = cell?.status ?? "uncovered";
                    return (
                      <tr key={r.id}>
                        <td>
                          <div className="mono text-xs text-muted">{r.ref}</div>
                          <div>{r.title}</div>
                        </td>
                        <td>
                          <span className="badge badge--neutral">{r.criticality}</span>
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
                            {(cell?.case_refs ?? []).join(", ") || "—"}
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
