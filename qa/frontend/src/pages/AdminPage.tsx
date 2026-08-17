import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/apiClient";
import { useProject } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/Toast";
import { roleLabels } from "@/lib/rbac";
import type {
  ApiKey,
  AuditLogEntry,
  Environment,
  ProjectMember,
  Role,
  User,
  Webhook,
} from "@/lib/types";
import { formatRelative } from "@/lib/utils";
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

type AdminTab = "team" | "members" | "environments" | "apikeys" | "webhooks" | "audit";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("team");

  return (
    <>
      <PageHeader title="Administration" />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        <Tabs
          tabs={[
            { id: "team", label: "Team & roles" },
            { id: "members", label: "Project members" },
            { id: "environments", label: "Environments" },
            { id: "apikeys", label: "API keys" },
            { id: "webhooks", label: "Webhooks" },
            { id: "audit", label: "Audit log" },
          ]}
          active={tab}
          onChange={(t) => setTab(t as AdminTab)}
        />
        <div style={{ marginTop: "var(--space-4)" }}>
          {tab === "team" && <TeamTab />}
          {tab === "members" && <MembersTab />}
          {tab === "environments" && <EnvironmentsTab />}
          {tab === "apikeys" && <ApiKeysTab />}
          {tab === "webhooks" && <WebhooksTab />}
          {tab === "audit" && <AuditTab />}
        </div>
      </div>
    </>
  );
}

/* ---- Team & roles ---- */

function TeamTab() {
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<User[]>(
    () => api.get("/users"),
    [],
  );
  const [inviteOpen, setInviteOpen] = useState(false);

  const changeRole = async (user: User, role: Role) => {
    try {
      await api.patch(`/users/${user.id}`, { role });
      success("Role updated", `${user.fullName} → ${roleLabels[role]}`);
      reload();
    } catch (err) {
      toastError("Update failed", (err as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">{data?.length ?? 0} users</span>
        {can("manage_project") ? (
          <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setInviteOpen(true)}>
            Invite user
          </Button>
        ) : null}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.fullName}</td>
                  <td className="mono">{u.email}</td>
                  <td>
                    {can("manage_project") ? (
                      <select
                        className="select"
                        style={{ width: 140, padding: "var(--space-1) var(--space-2)" }}
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                        aria-label={`Role for ${u.fullName}`}
                      >
                        {Object.entries(roleLabels).map(([r, label]) => (
                          <option key={r} value={r}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{roleLabels[u.role]}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? "badge--success" : "badge--neutral"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="text-muted">{formatRelative(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={() => {
          setInviteOpen(false);
          success("User invited");
          reload();
        }}
      />
    </>
  );
}

function InviteUserModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { error: toastError } = useToast();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("tester");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/users", { email, password, fullName, role });
      onSaved();
    } catch (err) {
      toastError("Invite failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Invite</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Email" required>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Full name" required>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Password" required help="Minimum 8 characters.">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Role">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {Object.entries(roleLabels).map(([r, label]) => (
              <option key={r} value={r}>{label}</option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* ---- Project members ---- */

function MembersTab() {
  const projectId = useProject().currentProject?.id ?? "";
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<ProjectMember[]>(
    () => api.get(`/projects/${projectId}/members`),
    [projectId],
  );

  const update = async (m: ProjectMember, projectRole: Role) => {
    try {
      await api.post(`/projects/${projectId}/members`, { email: m.email, projectRole });
      success("Member updated");
      reload();
    } catch (err) {
      toastError("Update failed", (err as Error).message);
    }
  };

  const remove = async (m: ProjectMember) => {
    try {
      await api.del(`/projects/${projectId}/members/${m.userId}`);
      success("Member removed");
      reload();
    } catch (err) {
      toastError("Remove failed", (err as Error).message);
    }
  };

  return (
    <>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Project role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.userId}>
                  <td className="font-semibold">{m.fullName ?? "—"}</td>
                  <td className="mono">{m.email ?? m.userId}</td>
                  <td>
                    {can("manage_project") ? (
                      <select
                        className="select"
                        style={{ width: 140, padding: "var(--space-1) var(--space-2)" }}
                        value={m.projectRole}
                        onChange={(e) => update(m, e.target.value as Role)}
                        aria-label={`Project role for ${m.fullName ?? m.userId}`}
                      >
                        {Object.entries(roleLabels).map(([r, label]) => (
                          <option key={r} value={r}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{roleLabels[m.projectRole]}</span>
                    )}
                  </td>
                  <td>
                    {can("manage_project") ? (
                      <Button size="xs" variant="ghost" onClick={() => remove(m)}>
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

/* ---- Environments ---- */

function EnvironmentsTab() {
  const projectId = useProject().currentProject?.id ?? "";
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<Environment[]>(
    () => api.get(`/projects/${projectId}/environments`),
    [projectId],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/environments`, { name, baseUrl, notes });
      success("Environment created");
      setCreateOpen(false);
      setName("");
      setBaseUrl("");
      setNotes("");
      reload();
    } catch (err) {
      toastError("Create failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">{data?.length ?? 0} environments</span>
        {can("manage_project") ? (
          <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
            New environment
          </Button>
        ) : null}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Base URL</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.map((env) => (
                <tr key={env.id}>
                  <td className="font-semibold">{env.name}</td>
                  <td className="mono">{env.baseUrl ?? "—"}</td>
                  <td className="text-muted">{env.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New environment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={create}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Base URL">
            <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* ---- API keys ---- */

function ApiKeysTab() {
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<ApiKey[]>(
    () => api.get("/api-keys"),
    [],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("ingest");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const key = await api.post<ApiKey>("/api-keys", {
        name,
        scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setNewKey(key);
      setName("");
      reload();
    } catch (err) {
      toastError("Create failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: ApiKey) => {
    try {
      await api.del(`/api-keys/${key.id}`);
      success("API key revoked");
      reload();
    } catch (err) {
      toastError("Revoke failed", (err as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">{data?.length ?? 0} keys</span>
        {can("manage_project") ? (
          <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
            New API key
          </Button>
        ) : null}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td className="font-semibold">{k.name}</td>
                  <td className="mono">{k.keyPrefix}…</td>
                  <td>{k.scopes.join(", ")}</td>
                  <td className="text-muted">{k.expiresAt ? formatRelative(k.expiresAt) : "Never"}</td>
                  <td>
                    <span className={`badge ${k.revokedAt ? "badge--danger" : "badge--success"}`}>
                      {k.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td>
                    {can("manage_project") && !k.revokedAt ? (
                      <Button size="xs" variant="ghost" onClick={() => revoke(k)}>
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New API key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={create}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Scopes" help="Comma-separated (e.g. ingest).">
            <input className="input mono" value={scopes} onChange={(e) => setScopes(e.target.value)} />
          </Field>
          {newKey?.key ? (
            <div className="panel" style={{ background: "var(--color-warningMuted)", borderColor: "var(--color-warning)" }}>
              <div className="panel__body">
                <p className="text-sm text-warning font-semibold">Copy this key now — it is shown only once.</p>
                <code className="mono" style={{ wordBreak: "break-all" }}>{newKey.key}</code>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

/* ---- Webhooks ---- */

function WebhooksTab() {
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi<Webhook[]>(
    () => api.get("/webhooks"),
    [],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("run.completed,defect.created");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/webhooks", {
        url,
        events: events.split(",").map((e) => e.trim()).filter(Boolean),
      });
      success("Webhook created");
      setCreateOpen(false);
      setUrl("");
      reload();
    } catch (err) {
      toastError("Create failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: Webhook) => {
    try {
      await api.del(`/webhooks/${w.id}`);
      success("Webhook removed");
      reload();
    } catch (err) {
      toastError("Remove failed", (err as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">{data?.length ?? 0} webhooks</span>
        {can("manage_project") ? (
          <Button variant="primary" size="sm" icon={<IconPlus />} onClick={() => setCreateOpen(true)}>
            New webhook
          </Button>
        ) : null}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.url}</td>
                  <td>{w.events.join(", ")}</td>
                  <td>
                    <span className={`badge ${w.isActive ? "badge--success" : "badge--neutral"}`}>
                      {w.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    {can("manage_project") ? (
                      <Button size="xs" variant="ghost" onClick={() => remove(w)}>
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New webhook"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={create}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="URL" required>
            <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Events" help="Comma-separated.">
            <input className="input mono" value={events} onChange={(e) => setEvents(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* ---- Audit log ---- */

function AuditTab() {
  const [action, setAction] = useState("");
  const { data, loading, error, reload } = useApi<AuditLogEntry[]>(
    () => api.get(`/audit-log?limit=200`),
    [],
  );
  const entries = (data ?? []).filter(
    (e) => !action || e.action.toLowerCase().includes(action.toLowerCase()),
  );

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="Filter by action…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter audit log by action"
        />
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data && entries.length === 0 ? (
        <EmptyState title="No audit entries" />
      ) : null}
      {data && entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRelative(entry.createdAt)}
                  </td>
                  <td className="mono text-xs">{entry.actorId ? entry.actorId.slice(0, 8) : "—"}</td>
                  <td><span className="badge badge--info">{entry.action}</span></td>
                  <td className="mono text-xs">
                    {entry.entityType ?? "—"}
                    {entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ""}
                  </td>
                  <td className="mono text-xs text-muted truncate" style={{ maxWidth: 320 }}>
                    {entry.metadata ? JSON.stringify(entry.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
