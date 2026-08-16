import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type { GatePolicy, Release } from "@/lib/types";
import { formatRelative, titleCase } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
} from "@/components/ui";
import { Badge, Field } from "@/components/ui";
import { IconChevronDown, IconRefresh } from "@/components/ui";

const DEFAULT_POLICY: GatePolicy = {
  minPassRate: 0.98,
  maxOpenBlockers: 0,
  maxOpenCritical: 0,
  minRequirementCoverage: 0.9,
};

export function ReleasesPage() {
  const projectId = useCurrentProjectId();
  const [selectedId, setSelectedId] = useState("");

  const { data: releases, loading, error, reload } = useApi<Release[]>(
    () => api.get(`/projects/${projectId}/releases`),
    [projectId],
  );

  useEffect(() => {
    if (!selectedId && releases && releases.length > 0) {
      setSelectedId(releases[0].id);
    }
  }, [releases, selectedId]);

  const selected = releases?.find((r) => r.id === selectedId) ?? releases?.[0] ?? null;

  return (
    <>
      <PageHeader
        title="Release Readiness"
        actions={
          <select
            className="select"
            style={{ width: 260 }}
            value={selectedId}
            aria-label="Select release"
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {releases?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {titleCase(r.status)}
              </option>
            ))}
          </select>
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {releases && releases.length === 0 ? (
          <EmptyState title="No releases" hint="Create a release to define and evaluate its quality gate." />
        ) : null}
        {selected ? (
          <ReleaseDetail release={selected} onChanged={reload} />
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function ReleaseDetail({
  release,
  onChanged,
}: {
  release: Release;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [evaluating, setEvaluating] = useState(false);
  const [policy, setPolicy] = useState<GatePolicy>(
    release.gate_policy_json ?? { ...DEFAULT_POLICY },
  );
  const [saving, setSaving] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPolicy(release.gate_policy_json ?? { ...DEFAULT_POLICY });
  }, [release.id, release.gate_policy_json]);

  const result = release.gate_result_json;

  const evaluate = async () => {
    setEvaluating(true);
    try {
      await api.post(`/releases/${release.id}/gate/evaluate`);
      success("Gate evaluated");
      onChanged();
    } catch (err) {
      toastError("Evaluation failed", (err as Error).message);
    } finally {
      setEvaluating(false);
    }
  };

  const savePolicy = async () => {
    setSaving(true);
    try {
      await api.patch(`/releases/${release.id}`, { gate_policy_json: policy });
      success("Policy saved");
      onChanged();
    } catch (err) {
      toastError("Save failed", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const override = async () => {
    if (!justification.trim()) return;
    setOverriding(true);
    try {
      await api.post(`/releases/${release.id}/gate/override`, {
        justification,
      });
      success("Gate overridden");
      setOverrideOpen(false);
      setJustification("");
      onChanged();
    } catch (err) {
      toastError("Override failed", (err as Error).message);
    } finally {
      setOverriding(false);
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 style={{ fontSize: "var(--font-xl)" }}>{release.name}</h2>
        <Badge tone={release.status === "gated" ? "warning" : "neutral"}>
          {titleCase(release.status)}
        </Badge>
        {result ? (
          <Badge
            tone={result.verdict === "pass" ? "success" : result.verdict === "waived" ? "warning" : "danger"}
          >
            {titleCase(result.verdict)}
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {can("approve_gate") ? (
            <>
              <Button variant="primary" size="sm" icon={<IconRefresh />} loading={evaluating} onClick={evaluate}>
                Evaluate gate
              </Button>
              {result && result.verdict === "fail" ? (
                <Button variant="danger" size="sm" onClick={() => setOverrideOpen(true)}>
                  Override
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <h3 className="panel__title">Gate policy</h3>
          {can("approve_gate") ? (
            <Button variant="secondary" size="sm" loading={saving} onClick={savePolicy}>
              Save policy
            </Button>
          ) : null}
        </div>
        <div className="panel__body space-y-3">
          <PolicyField label="Minimum pass rate" value={policy.minPassRate} onChange={(v) => setPolicy((p) => ({ ...p, minPassRate: v }))} />
          <PolicyField label="Max open blockers" value={policy.maxOpenBlockers} onChange={(v) => setPolicy((p) => ({ ...p, maxOpenBlockers: v }))} />
          <PolicyField label="Max open critical" value={policy.maxOpenCritical} onChange={(v) => setPolicy((p) => ({ ...p, maxOpenCritical: v }))} />
          <PolicyField label="Min requirement coverage" value={policy.minRequirementCoverage} onChange={(v) => setPolicy((p) => ({ ...p, minRequirementCoverage: v }))} />
        </div>
      </div>

      {result ? (
        <div className="panel">
          <div className="panel__header">
            <h3 className="panel__title">Evaluation results</h3>
            <span className="ml-auto text-xs mono text-muted">
              policy {result.policyHash?.slice(0, 12)}
            </span>
          </div>
          {result.override ? (
            <div className="panel__body" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-sm text-warning">
                Waived by {result.override.byName ?? result.override.by} — {result.override.reason}
              </p>
              <p className="text-xs text-muted mt-1">{formatRelative(result.override.at)}</p>
            </div>
          ) : null}
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Criterion</th>
                  <th>Required</th>
                  <th>Actual</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {result.criteria.map((c) => {
                  const isOpen = expanded.has(c.key);
                  return (
                    <FragmentRow
                      key={c.key}
                      criterion={c}
                      open={isOpen}
                      onToggle={() => toggleExpand(c.key)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="Not evaluated yet" hint="Run the evaluation to compute criteria against the frozen build." />
      )}

      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override quality gate"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={overriding} disabled={!justification.trim()} onClick={override}>
              Override gate
            </Button>
          </>
        }
      >
        <Field label="Justification" required help="Recorded in the audit log and rendered permanently.">
          <textarea
            className="textarea"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why is this gate being waived?"
          />
        </Field>
      </Modal>
    </div>
  );
}

function PolicyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const { can } = useAuth();
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm flex-1">{label}</label>
      <input
        className="input"
        type="number"
        step={0.01}
        style={{ width: 140 }}
        value={value ?? ""}
        disabled={!can("approve_gate")}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function FragmentRow({
  criterion,
  open,
  onToggle,
}: {
  criterion: {
    key: string;
    required: number;
    actual: number;
    passed: boolean;
    evidence: Record<string, unknown>;
  };
  open: boolean;
  onToggle: () => void;
}) {
  const evidenceEntries = useMemo(
    () => Object.entries(criterion.evidence ?? {}).filter(([, v]) => Array.isArray(v)),
    [criterion],
  );
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          <IconChevronDown
            width={14}
            height={14}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }}
          />
        </td>
        <td className="mono">{criterion.key}</td>
        <td className="mono">{criterion.required}</td>
        <td className="mono">{criterion.actual}</td>
        <td>
          <Badge tone={criterion.passed ? "success" : "danger"}>
            {criterion.passed ? "Pass" : "Fail"}
          </Badge>
        </td>
      </tr>
      {open ? (
        <tr>
          <td />
          <td colSpan={4} style={{ background: "var(--color-bgElevated)" }}>
            <div className="space-y-2">
              {evidenceEntries.length === 0 ? (
                <p className="text-muted text-sm">No drill-down evidence rows.</p>
              ) : null}
              {evidenceEntries.map(([key, val]) => (
                <div key={key} className="text-sm">
                  <span className="font-semibold">{key}:</span>{" "}
                  <span className="mono text-xs text-muted">
                    {(val as unknown[]).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
