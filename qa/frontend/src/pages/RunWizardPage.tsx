import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api, buildQuery } from "@/lib/apiClient";
import { useProject } from "@/lib/project";
import { useToast } from "@/components/ui/Toast";
import type {
  Build,
  Environment,
  Paginated,
  ProjectMember,
  Suite,
  SuiteFilter,
  TestCase,
  TestRun,
} from "@/lib/types";
import { titleCase } from "@/lib/utils";
import { Button, PageHeader } from "@/components/ui";
import { Field } from "@/components/ui";

type Source = "suite" | "filter" | "cases";

const STEPS = ["Source", "Environment", "Build", "Testers", "Review"];

export function RunWizardPage() {
  const projectId = useProject().currentProject?.id ?? "";
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [step, setStep] = useState(0);
  const [source, setSource] = useState<Source>("suite");
  const [suiteId, setSuiteId] = useState("");
  const [filter, setFilter] = useState<SuiteFilter>({});
  const [caseIds, setCaseIds] = useState<Set<string>>(new Set());
  const [environmentId, setEnvironmentId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [buildLabel, setBuildLabel] = useState("");
  const [assignees, setAssignees] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: suites } = useApi<Suite[]>(
    () => api.get(`/projects/${projectId}/suites`),
    [projectId],
  );
  const { data: environments } = useApi<Environment[]>(
    () => api.get(`/projects/${projectId}/environments`),
    [projectId],
  );
  const { data: builds } = useApi<Build[]>(
    () => api.get<Build[]>(`/projects/${projectId}/builds`).catch(() => [] as Build[]),
    [projectId],
  );
  const { data: members } = useApi<ProjectMember[]>(
    () => api.get(`/projects/${projectId}/members`),
    [projectId],
  );
  const { data: casesPage } = useApi<Paginated<TestCase>>(
    () =>
      api.get(
        `/projects/${projectId}/cases${buildQuery({ page: 1, pageSize: 200 })}`,
      ),
    [projectId],
  );
  const { data: match } = useApi<Paginated<TestCase>>(
    () =>
      source === "filter"
        ? api.get(
            `/projects/${projectId}/cases${buildQuery({ page: 1, pageSize: 1, ...filter })}`,
          )
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 1 }),
    [projectId, filter, source],
  );

  const testers = useMemo(
    () => (members ?? []).filter((m) => ["tester", "qa_lead", "owner"].includes(m.project_role)),
    [members],
  );

  const previewCount =
    source === "suite"
      ? suites?.find((s) => s.id === suiteId)?.case_count ?? 0
      : source === "filter"
        ? match?.total ?? 0
        : caseIds.size;

  const create = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name || "Manual run",
        environment_id: environmentId,
        build_id: buildId || null,
        build_label: buildLabel || undefined,
      };
      if (source === "suite") body.suite_id = suiteId;
      else if (source === "filter") body.filter_json = filter;
      else body.case_ids = Array.from(caseIds);

      const run = await api.post<TestRun>(`/projects/${projectId}/runs`, body);
      if (assignees.size > 0) {
        await api.post(`/runs/${run.id}/assign`, { userIds: Array.from(assignees) });
      }
      success("Run created");
      navigate(`/runs/${run.id}`);
    } catch (err) {
      toastError("Failed to create run", (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const canNext = (): boolean => {
    if (step === 0) {
      if (source === "suite") return !!suiteId;
      if (source === "cases") return caseIds.size > 0;
      return true;
    }
    if (step === 1) return !!environmentId;
    if (step === 2) return !!(buildId || buildLabel.trim());
    return true;
  };

  return (
    <>
      <PageHeader
        title="New Test Run"
        actions={<Button variant="ghost" onClick={() => navigate("/runs")}>Cancel</Button>}
      />
      <div className="content" style={{ maxWidth: 760 }}>
        <ol className="flex gap-2 items-center mb-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className="badge"
                style={{
                  background:
                    i === step ? "var(--color-accent)" : i < step ? "var(--color-accentMuted)" : "var(--color-surfaceRaised)",
                  color: i <= step ? "var(--color-white)" : "var(--color-textMuted)",
                }}
              >
                {i + 1}
              </span>
              <span className={i === step ? "font-semibold" : "text-muted"}>{label}</span>
              {i < STEPS.length - 1 ? <span className="text-muted">→</span> : null}
            </li>
          ))}
        </ol>

        <div className="panel">
          <div className="panel__body space-y-3">
            {step === 0 && (
              <>
                <Field label="Case source">
                  <div className="flex gap-2">
                    {(["suite", "filter", "cases"] as Source[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`btn ${source === s ? "btn--primary" : "btn--secondary"}`}
                        onClick={() => setSource(s)}
                      >
                        {titleCase(s)}
                      </button>
                    ))}
                  </div>
                </Field>
                {source === "suite" && (
                  <Field label="Suite" required>
                    <select className="select" value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                      <option value="">Select a suite…</option>
                      {suites?.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.case_count ?? 0})</option>
                      ))}
                    </select>
                  </Field>
                )}
                {source === "filter" && (
                  <div className="space-y-3">
                    <div className="form-row">
                      <Field label="Folder">
                        <input
                          className="input"
                          value={filter.folder ?? ""}
                          onChange={(e) => setFilter((f) => ({ ...f, folder: e.target.value || undefined }))}
                        />
                      </Field>
                      <Field label="Type">
                        <select
                          className="select"
                          value={filter.type ?? ""}
                          onChange={(e) => setFilter((f) => ({ ...f, type: (e.target.value || undefined) as SuiteFilter["type"] }))}
                        >
                          <option value="">Any</option>
                          {["functional", "regression", "smoke", "integration", "e2e", "performance", "security"].map((t) => (
                            <option key={t} value={t}>{titleCase(t)}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <span className="badge badge--accent">{match?.total ?? 0} cases match</span>
                  </div>
                )}
                {source === "cases" && (
                  <div className="table-wrap" style={{ maxHeight: 320 }}>
                    <table className="table table--dense">
                      <thead>
                        <tr>
                          <th>Select</th>
                          <th>Ref</th>
                          <th>Title</th>
                          <th>Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {casesPage?.items.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <input
                                type="checkbox"
                                className="checkbox"
                                checked={caseIds.has(c.id)}
                                onChange={() => {
                                  const next = new Set(caseIds);
                                  if (next.has(c.id)) next.delete(c.id);
                                  else next.add(c.id);
                                  setCaseIds(next);
                                }}
                                aria-label={`Select ${c.ref}`}
                              />
                            </td>
                            <td className="mono">{c.ref}</td>
                            <td>{c.title}</td>
                            <td>{titleCase(c.priority)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {step === 1 && (
              <Field label="Environment" required>
                <select className="select" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
                  <option value="">Select environment…</option>
                  {environments?.map((env) => (
                    <option key={env.id} value={env.id}>{env.name}{env.base_url ? ` — ${env.base_url}` : ""}</option>
                  ))}
                </select>
              </Field>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <Field label="Build">
                  <select
                    className="select"
                    value={buildId}
                    onChange={(e) => setBuildId(e.target.value)}
                  >
                    <option value="">Select an existing build…</option>
                    {builds?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.version_label}{b.commit_sha ? ` — ${b.commit_sha.slice(0, 7)}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Or new build version label" help="Used when no build is selected above.">
                  <input
                    className="input mono"
                    placeholder="2.15.0-rc1"
                    value={buildLabel}
                    onChange={(e) => setBuildLabel(e.target.value)}
                  />
                </Field>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-2">
                <p className="text-sm text-muted">Assign testers (optional).</p>
                {testers.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2" style={{ padding: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={assignees.has(m.user_id)}
                      onChange={() => {
                        const next = new Set(assignees);
                        if (next.has(m.user_id)) next.delete(m.user_id);
                        else next.add(m.user_id);
                        setAssignees(next);
                      }}
                    />
                    <span>{m.full_name ?? m.email ?? m.user_id}</span>
                    <span className="badge badge--neutral">{titleCase(m.project_role)}</span>
                  </label>
                ))}
                {testers.length === 0 ? (
                  <p className="text-muted">No testers available in this project.</p>
                ) : null}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <Field label="Run name">
                  <input className="input" placeholder="Smoke — staging" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <div className="flex items-center gap-2">
                  <span className="badge badge--accent">{previewCount} cases</span>
                  <span className="badge badge--neutral">Source: {source}</span>
                  {assignees.size > 0 ? (
                    <span className="badge badge--info">{assignees.size} testers</span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="panel__header" style={{ borderTop: "1px solid var(--color-border)", borderBottom: "none" }}>
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            <div className="flex-1" />
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="primary" loading={creating} disabled={previewCount === 0} onClick={create}>
                Create run
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
