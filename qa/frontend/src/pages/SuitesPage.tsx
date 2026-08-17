import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { api, buildQuery } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import type {
  CaseType,
  Paginated,
  Suite,
  SuiteFilter,
  TestCase,
  TestPlan,
} from "@/lib/types";
import { titleCase } from "@/lib/utils";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
} from "@/components/ui";
import { Field, Tabs } from "@/components/ui";
import { IconPlus } from "@/components/ui";

type Mode = "static" | "filter";

export function SuitesPage() {
  const projectId = useCurrentProjectId();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [tab, setTab] = useState<"suites" | "plans">("suites");

  const { data: suites, loading, error, reload } = useApi<Suite[]>(
    () => api.get(`/projects/${projectId}/suites`),
    [projectId],
  );

  const { data: plans, loading: plansLoading, error: plansError, reload: reloadPlans } =
    useApi<TestPlan[]>(() => api.get(`/projects/${projectId}/plans`), [projectId]);

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Suites & Plans"
        actions={
          can("plan_runs") ? (
            <Button variant="primary" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
              New {tab === "suites" ? "suite" : "plan"}
            </Button>
          ) : null
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        <Tabs
          tabs={[
            { id: "suites", label: "Suites" },
            { id: "plans", label: "Plans" },
          ]}
          active={tab}
          onChange={(t) => setTab(t as "suites" | "plans")}
        />
        <div style={{ marginTop: "var(--space-4)" }}>
          {tab === "suites" ? (
            <SuitesList
              suites={suites}
              loading={loading}
              error={error}
              reload={reload}
            />
          ) : (
            <PlansList
              plans={plans}
              loading={plansLoading}
              error={plansError}
              reload={reloadPlans}
              projectId={projectId}
            />
          )}
        </div>
      </div>

      <CreateSuiteModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        onSaved={() => {
          setCreateOpen(false);
          success("Suite created");
          reload();
        }}
        onError={(m) => toastError("Create failed", m)}
      />
    </>
  );
}

function SuitesList({
  suites,
  loading,
  error,
  reload,
}: {
  suites: Suite[] | null;
  loading: boolean;
  error: ReturnType<typeof useApi>["error"];
  reload: () => void;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="card-grid">
      {suites && suites.length === 0 ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <EmptyState title="No suites" hint="Create a suite from static cases or a saved filter." />
        </div>
      ) : null}
      {suites?.map((s) => (
        <div className="panel" key={s.id}>
          <div className="panel__header">
            <h3 className="panel__title">{s.name}</h3>
          </div>
          <div className="panel__body">
            <p className="text-muted text-sm mb-3">{s.description ?? "No description"}</p>
            <div className="flex items-center gap-2">
              <span className="badge badge--info">
                {s.caseCount ?? 0} cases
              </span>
              <span className="badge badge--neutral">
                {s.filter ? "Saved filter" : "Static membership"}
              </span>
            </div>
            {s.filter ? (
              <pre className="mono text-xs text-muted mt-3" style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(s.filter, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlansList({
  plans,
  loading,
  error,
  reload,
  projectId,
}: {
  plans: TestPlan[] | null;
  loading: boolean;
  error: ReturnType<typeof useApi>["error"];
  reload: () => void;
  projectId: string;
}) {
  const { success, error: toastError } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/plans`, { name, description });
      success("Plan created");
      setCreateOpen(false);
      setName("");
      setDescription("");
      reload();
    } catch (err) {
      toastError("Create failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">{plans?.length ?? 0} plans</span>
        <Button variant="secondary" size="sm" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
          New plan
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {plans && plans.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <EmptyState title="No plans" />
                </td>
              </tr>
            ) : null}
            {plans?.map((p) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.name}</td>
                <td className="text-muted">{p.description ?? "—"}</td>
                <td>{titleCase(p.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New plan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={create}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */

function CreateSuiteModal({
  open,
  onClose,
  projectId,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("filter");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SuiteFilter>({});

  const { data: match, loading: matchLoading } = useApi<Paginated<TestCase>>(
    () =>
      api.get(
        `/projects/${projectId}/cases${buildQuery({
          page: 1,
          pageSize: 1,
          ...filter,
        })}`,
      ),
    [projectId, filter, open],
  );

  const create = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/suites`, {
        name,
        description,
        filter: mode === "filter" ? filter : null,
      });
      onSaved();
      setName("");
      setDescription("");
      setFilter({});
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New suite"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={create} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label="Membership">
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn ${mode === "filter" ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setMode("filter")}
            >
              Saved filter
            </button>
            <button
              type="button"
              className={`btn ${mode === "static" ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setMode("static")}
            >
              Static cases
            </button>
          </div>
        </Field>

        {mode === "filter" ? (
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
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, type: (e.target.value || undefined) as CaseType | undefined }))
                  }
                >
                  <option value="">Any</option>
                  {["functional", "regression", "smoke", "integration", "e2e", "performance", "security"].map((t) => (
                    <option key={t} value={t}>{titleCase(t)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge--accent">
                {matchLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> …
                  </span>
                ) : (
                  `${match?.total ?? 0} cases match`
                )}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted text-sm">
            Static membership is created empty; add cases from the suite afterwards.
          </p>
        )}
      </div>
    </Modal>
  );
}
