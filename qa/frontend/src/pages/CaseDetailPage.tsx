import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type {
  CaseHistory,
  CaseStep,
  Defect,
  Paginated,
  Requirement,
  TestCase,
  TestCaseVersion,
} from "@/lib/types";
import { formatDuration, formatRelative, titleCase } from "@/lib/utils";
import { Sparkline } from "@/components/charts";
import {
  Button,
  CriticalityBadge,
  DefectStatusBadge,
  EmptyState,
  ErrorState,
  ExecutionBadge,
  LoadingState,
  PageHeader,
  PriorityBadge,
  SeverityBadge,
} from "@/components/ui";
import { Field, Tabs } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/ui";

type TabId = "steps" | "versions" | "requirements" | "history" | "defects";

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const projectId = useCurrentProjectId();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [tab, setTab] = useState<TabId>("steps");

  const { data: testCase, loading, error, reload, setData } = useApi<TestCase>(
    () => (isNew ? Promise.resolve(null as unknown as TestCase) : api.get(`/cases/${id}`)),
    [id, isNew],
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Case" />
        <div className="content">
          <LoadingState />
        </div>
      </>
    );
  }

  if (!isNew && error) {
    return (
      <>
        <PageHeader title="Case" />
        <div className="content">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          isNew
            ? "New test case"
            : `${testCase?.ref ?? "Case"} — ${testCase?.title ?? ""}`
        }
        actions={
          !isNew ? (
            <div className="flex items-center gap-2">
              {testCase?.version?.version != null ? (
                <span className="text-muted text-sm mono">
                  v{testCase.version?.version}
                </span>
              ) : null}
              <Button variant="ghost" onClick={() => navigate("/cases")}>
                Back to repository
              </Button>
            </div>
          ) : null
        }
      />
      <div className="content">
        <Tabs
          tabs={[
            { id: "steps", label: "Steps" },
            { id: "versions", label: "Versions" },
            { id: "requirements", label: "Requirements" },
            { id: "history", label: "Execution history" },
            { id: "defects", label: "Defects" },
          ]}
          active={tab}
          onChange={(id) => setTab(id as TabId)}
        />
        <div style={{ marginTop: "var(--space-4)" }}>
          {tab === "steps" && (
            <StepsTab
              testCase={testCase}
              isNew={isNew}
              projectId={projectId}
              onSaved={(tc) => {
                setData(tc);
                if (isNew) navigate(`/cases/${tc.id}`, { replace: true });
              }}
              onError={(m) => toastError("Save failed", m)}
              onSuccess={(m) => success("Saved", m)}
            />
          )}
          {tab === "versions" && <VersionsTab testCase={testCase} />}
          {tab === "requirements" && (
            <RequirementsTab
              testCase={testCase}
              projectId={projectId}
              reload={reload}
            />
          )}
          {tab === "history" && <HistoryTab caseId={id ?? ""} />}
          {tab === "defects" && <DefectsTab testCase={testCase} projectId={projectId} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

interface CaseDraft {
  title: string;
  folder_path: string;
  priority: string;
  type: string;
  automation_status: string;
  automation_key: string;
  tags: string;
  preconditions: string;
  expected_result: string;
  estimated_minutes: string;
  steps: CaseStep[];
  change_note: string;
}

function StepsTab({
  testCase,
  isNew,
  projectId,
  onSaved,
  onError,
  onSuccess,
}: {
  testCase: TestCase | null;
  isNew: boolean;
  projectId: string;
  onSaved: (tc: TestCase) => void;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}) {
  const { can } = useAuth();
  const editable = can("author_cases");

  const current = testCase?.version ?? testCase?.versions?.[0] ?? null;

  const [draft, setDraft] = useState<CaseDraft>({
    title: testCase?.title ?? "",
    folder_path: testCase?.folder_path ?? "",
    priority: testCase?.priority ?? "medium",
    type: testCase?.type ?? "functional",
    automation_status: testCase?.automation_status ?? "manual",
    automation_key: testCase?.automation_key ?? "",
    tags: current?.tags.join(", ") ?? "",
    preconditions: current?.preconditions ?? "",
    expected_result: current?.expected_result ?? "",
    estimated_minutes: String(current?.estimated_minutes ?? ""),
    steps: current?.steps_json ?? [{ index: 1, action: "", expected: "" }],
    change_note: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      title: testCase?.title ?? "",
      folder_path: testCase?.folder_path ?? "",
      priority: testCase?.priority ?? "medium",
      type: testCase?.type ?? "functional",
      automation_status: testCase?.automation_status ?? "manual",
      automation_key: testCase?.automation_key ?? "",
      tags: current?.tags.join(", ") ?? "",
      preconditions: current?.preconditions ?? "",
      expected_result: current?.expected_result ?? "",
      estimated_minutes: String(current?.estimated_minutes ?? ""),
      steps: current?.steps_json ?? [{ index: 1, action: "", expected: "" }],
      change_note: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCase?.id]);

  const setStep = (i: number, patch: Partial<CaseStep>) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  };
  const addStep = () =>
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { index: d.steps.length + 1, action: "", expected: "" }],
    }));
  const removeStep = (i: number) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps
        .filter((_, idx) => idx !== i)
        .map((s, idx) => ({ ...s, index: idx + 1 })),
    }));
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return {
        ...d,
        steps: next.map((s, idx) => ({ ...s, index: idx + 1 })),
      };
    });

  const save = async () => {
    setSaving(true);
    const payload = {
      title: draft.title,
      folder_path: draft.folder_path || "/",
      priority: draft.priority,
      type: draft.type,
      automation_status: draft.automation_status,
      automation_key: draft.automation_key || null,
      tags: draft.tags
        ? draft.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
      preconditions: draft.preconditions,
      expected_result: draft.expected_result,
      estimated_minutes: draft.estimated_minutes
        ? Number(draft.estimated_minutes)
        : null,
      steps: draft.steps,
      change_note: draft.change_note || undefined,
    };
    try {
      const saved = isNew
        ? await api.post<TestCase>(`/projects/${projectId}/cases`, payload)
        : await api.patch<TestCase>(`/cases/${testCase?.id}`, payload);
      onSaved(saved);
      onSuccess(isNew ? "Case created" : "New version created");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: "var(--space-4)", alignItems: "start" }}>
      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Steps</h2>
        </div>
        <div className="panel__body space-y-2">
          {draft.steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-2 items-start"
              style={{
                background: "var(--color-bgElevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-2)",
              }}
            >
              <span
                className="mono text-muted"
                style={{ width: 24, textAlign: "center", paddingTop: 6 }}
              >
                {i + 1}
              </span>
              <div className="flex-1 flex flex-col gap-2">
                <input
                  className="input"
                  placeholder="Action"
                  aria-label={`Step ${i + 1} action`}
                  value={step.action}
                  disabled={!editable}
                  onChange={(e) => setStep(i, { action: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Expected result"
                  aria-label={`Step ${i + 1} expected result`}
                  value={step.expected}
                  disabled={!editable}
                  onChange={(e) => setStep(i, { expected: e.target.value })}
                />
              </div>
              {editable ? (
                <div className="flex flex-col gap-1">
                  <button
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => moveStep(i, -1)}
                    aria-label={`Move step ${i + 1} up`}
                    disabled={i === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => moveStep(i, 1)}
                    aria-label={`Move step ${i + 1} down`}
                    disabled={i === draft.steps.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => removeStep(i)}
                    aria-label={`Remove step ${i + 1}`}
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {editable ? (
            <Button variant="ghost" icon={<IconPlus />} onClick={addStep}>
              Add step
            </Button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Properties</h2>
        </div>
        <div className="panel__body space-y-3">
          <Field label="Title" required>
            <input
              className="input"
              value={draft.title}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </Field>
          <Field label="Folder path">
            <input
              className="input mono"
              value={draft.folder_path}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, folder_path: e.target.value }))}
            />
          </Field>
          <Field label="Priority">
            <select
              className="select"
              value={draft.priority}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
            >
              {["low", "medium", "high", "critical"].map((p) => (
                <option key={p} value={p}>{titleCase(p)}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              className="select"
              value={draft.type}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            >
              {["functional", "regression", "smoke", "integration", "e2e", "performance", "security"].map((t) => (
                <option key={t} value={t}>{titleCase(t)}</option>
              ))}
            </select>
          </Field>
          <Field label="Automation status">
            <select
              className="select"
              value={draft.automation_status}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, automation_status: e.target.value }))}
            >
              {["manual", "automated", "candidate"].map((a) => (
                <option key={a} value={a}>{titleCase(a)}</option>
              ))}
            </select>
          </Field>
          <Field label="Automation key">
            <input
              className="input mono"
              value={draft.automation_key}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, automation_key: e.target.value }))}
            />
          </Field>
          <Field label="Tags" help="Comma-separated.">
            <input
              className="input"
              value={draft.tags}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
            />
          </Field>
          <Field label="Preconditions">
            <textarea
              className="textarea"
              value={draft.preconditions}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, preconditions: e.target.value }))}
            />
          </Field>
          <Field label="Expected result">
            <textarea
              className="textarea"
              value={draft.expected_result}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, expected_result: e.target.value }))}
            />
          </Field>
          <Field label="Estimated minutes">
            <input
              className="input"
              type="number"
              min={0}
              value={draft.estimated_minutes}
              disabled={!editable}
              onChange={(e) => setDraft((d) => ({ ...d, estimated_minutes: e.target.value }))}
            />
          </Field>
          {!isNew ? (
            <Field label="Change note" help="Recorded on the new version.">
              <input
                className="input"
                value={draft.change_note}
                disabled={!editable}
                onChange={(e) => setDraft((d) => ({ ...d, change_note: e.target.value }))}
              />
            </Field>
          ) : null}
          {editable ? (
            <Button
              variant="primary"
              loading={saving}
              onClick={save}
              style={{ width: "100%" }}
            >
              {isNew ? "Create case" : "Save new version"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function VersionsTab({ testCase }: { testCase: TestCase | null }) {
  const versions = useMemo(
    () => (testCase?.versions ?? []).slice().sort((a, b) => b.version - a.version),
    [testCase],
  );
  const [left, setLeft] = useState<number | "">("");
  const [right, setRight] = useState<number | "">("");

  useEffect(() => {
    if (versions.length >= 2) {
      setLeft(versions[1].version);
      setRight(versions[0].version);
    }
  }, [versions.length]);

  const leftVersion = versions.find((v) => v.version === left) ?? null;
  const rightVersion = versions.find((v) => v.version === right) ?? null;

  if (versions.length === 0) {
    return <EmptyState title="No versions yet" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <select
          className="select"
          style={{ width: 180 }}
          value={left}
          aria-label="Left version"
          onChange={(e) => setLeft(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">—</option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>v{v.version} — {formatRelative(v.created_at)}</option>
          ))}
        </select>
        <span className="text-muted">vs</span>
        <select
          className="select"
          style={{ width: 180 }}
          value={right}
          aria-label="Right version"
          onChange={(e) => setRight(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">—</option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>v{v.version} — {formatRelative(v.created_at)}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
        <VersionSteps title={leftVersion ? `Version ${leftVersion.version}` : "Empty"} version={leftVersion} />
        <VersionSteps title={rightVersion ? `Version ${rightVersion.version}` : "Empty"} version={rightVersion} />
      </div>
    </div>
  );
}

function VersionSteps({ title, version }: { title: string; version: TestCaseVersion | null }) {
  return (
    <div className="panel">
      <div className="panel__header">
        <h3 className="panel__title">{title}</h3>
        {version?.change_note ? (
          <span className="text-muted text-xs ml-auto">{version.change_note}</span>
        ) : null}
      </div>
      <div className="panel__body">
        {!version ? (
          <p className="text-muted">No version selected.</p>
        ) : (
          <ol className="space-y-2" style={{ paddingLeft: "var(--space-5)" }}>
            {version.steps_json.map((s) => (
              <li key={s.index}>
                <div className="text-sm">{s.action}</div>
                <div className="text-xs text-muted">Expected: {s.expected}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RequirementsTab({
  testCase,
  projectId,
  reload,
}: {
  testCase: TestCase | null;
  projectId: string;
  reload: () => void;
}) {
  const { can } = useAuth();
  const { error: toastError } = useToast();
  const { data: reqs, loading, error } = useApi<Requirement[]>(
    () => api.get(`/projects/${projectId}/requirements`),
    [projectId],
  );
  const linked = useMemo(
    () => new Set((testCase?.requirements ?? []).map((r) => r.id)),
    [testCase],
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (req: Requirement) => {
    setBusyId(req.id);
    try {
      if (linked.has(req.id)) {
        await api.del(`/cases/${testCase?.id}/requirements/${req.id}`);
      } else {
        await api.post(`/cases/${testCase?.id}/requirements`, { requirement_id: req.id });
      }
      reload();
    } catch (err) {
      toastError("Failed to update requirement link", (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Title</th>
            <th>Criticality</th>
            <th>Status</th>
            <th>Linked</th>
          </tr>
        </thead>
        <tbody>
          {reqs?.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.ref}</td>
              <td>{r.title}</td>
              <td><CriticalityBadge criticality={r.criticality} /></td>
              <td>{titleCase(r.status)}</td>
              <td>
                <input
                  type="checkbox"
                  className="checkbox"
                  disabled={!can("author_cases") || busyId === r.id}
                  checked={linked.has(r.id)}
                  onChange={() => toggle(r)}
                  aria-label={`Link ${r.ref}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HistoryTab({ caseId }: { caseId: string }) {
  const { data, loading, error, reload } = useApi<CaseHistory>(
    () => api.get(`/cases/${caseId}/history`),
    [caseId],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Flake trend</h2>
          <span className="ml-auto text-sm text-muted">
            score {data.flake_score.toFixed(3)} · {titleCase(data.verdict)}
          </span>
        </div>
        <div className="panel__body">
          {data.flake.length === 0 ? (
            <EmptyState title="No flake data" />
          ) : (
            <Sparkline values={data.flake.map((f) => f.pass_rate * 100)} width={640} height={80} />
          )}
        </div>
      </div>
      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Execution timeline</h2>
        </div>
        <div className="panel__body">
          {data.executions.length === 0 ? (
            <EmptyState title="No executions" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Build</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Duration</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.executions.map((ex) => (
                  <tr key={ex.id}>
                    <td className="mono">{ex.run_name ?? ex.run_id.slice(0, 8)}</td>
                    <td className="mono">{ex.build_label ?? "—"}</td>
                    <td><ExecutionBadge status={ex.status} /></td>
                    <td>{ex.attempt}</td>
                    <td>{formatDuration(ex.duration_ms)}</td>
                    <td className="text-muted">{formatRelative(ex.executed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DefectsTab({
  testCase,
  projectId,
}: {
  testCase: TestCase | null;
  projectId: string;
}) {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<Paginated<Defect>>(
    () =>
      api.get(
        `/projects/${projectId}/defects${testCase ? `?q=${encodeURIComponent(testCase.ref)}` : ""}`,
      ),
    [projectId, testCase?.ref],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

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
          </tr>
        </thead>
        <tbody>
          {data && data.items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState title="No defects reference this case" />
              </td>
            </tr>
          ) : null}
          {data?.items.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => navigate(`/defects?open=${d.id}`)}>
              <td className="mono">{d.ref}</td>
              <td>{d.title}</td>
              <td><SeverityBadge severity={d.severity} /></td>
              <td><PriorityBadge priority={d.priority} /></td>
              <td><DefectStatusBadge status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
