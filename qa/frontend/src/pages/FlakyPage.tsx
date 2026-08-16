import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type { FlakySignal } from "@/lib/types";
import { OutcomeDots } from "@/components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  FlakyBadge,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { Field, Modal } from "@/components/ui";

export function FlakyPage() {
  const projectId = useCurrentProjectId();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<FlakySignal[]>(
    () => api.get(`/projects/${projectId}/flaky`),
    [projectId],
  );
  const [quarantine, setQuarantine] = useState<FlakySignal | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = [...(data ?? [])].sort((a, b) => b.flake_score - a.flake_score);

  const submitQuarantine = async () => {
    if (!quarantine) return;
    setBusy(true);
    try {
      await api.post(`/cases/${quarantine.test_case_id}/quarantine`, { reason });
      success("Case quarantined", quarantine.test_case?.ref);
      setQuarantine(null);
      setReason("");
      reload();
    } catch (err) {
      toastError("Quarantine failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const release = async (signal: FlakySignal) => {
    try {
      await api.del(`/cases/${signal.test_case_id}/quarantine`);
      success("Quarantine released", signal.test_case?.ref);
      reload();
    } catch (err) {
      toastError("Release failed", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Flaky Queue" />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data && sorted.length === 0 ? (
          <EmptyState title="No flaky cases" hint="Flakiness is computed from recent execution history." />
        ) : null}
        {data && sorted.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Title</th>
                  <th>Verdict</th>
                  <th>Flake score</th>
                  <th>Runs</th>
                  <th>Transitions</th>
                  <th>Outcome timeline</th>
                  <th>Quarantine</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.test_case?.ref ?? s.test_case_id.slice(0, 8)}</td>
                    <td className="truncate" style={{ maxWidth: 260 }}>{s.test_case?.title ?? "—"}</td>
                    <td><FlakyBadge verdict={s.verdict} /></td>
                    <td className="mono">{s.flake_score.toFixed(3)}</td>
                    <td>{s.total_runs}</td>
                    <td>{s.transitions}</td>
                    <td>
                      <OutcomeDots
                        outcomes={(s.timeline ?? []).map((t) => ({
                          status: t.status,
                          label: t.build_label,
                        }))}
                      />
                    </td>
                    <td>
                      {s.quarantined ? (
                        <Button size="xs" variant="secondary" onClick={() => release(s)}>
                          Release
                        </Button>
                      ) : can("quarantine_flaky") ? (
                        <Button size="xs" variant="danger" onClick={() => setQuarantine(s)}>
                          Quarantine
                        </Button>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Modal
        open={!!quarantine}
        onClose={() => setQuarantine(null)}
        title={`Quarantine ${quarantine?.test_case?.ref ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuarantine(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={submitQuarantine}>
              Quarantine
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <textarea
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this case being quarantined?"
          />
        </Field>
      </Modal>
    </>
  );
}
