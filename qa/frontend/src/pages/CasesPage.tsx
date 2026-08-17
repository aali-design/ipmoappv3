import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "@/lib/useApi";
import { api, buildQuery } from "@/lib/apiClient";
import { useCurrentProjectId } from "@/lib/project";
import { useAuth } from "@/lib/auth";
import { useVirtualRows } from "@/lib/useVirtual";
import { useToast } from "@/components/ui/Toast";
import type {
  AutomationStatus,
  CasePriority,
  CaseType,
  Paginated,
  TestCase,
} from "@/lib/types";
import { titleCase } from "@/lib/utils";
import {
  AutomationBadge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Pagination,
  PriorityBadge,
} from "@/components/ui";
import { IconFolder, IconSearch } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { Field } from "@/components/ui/Tabs";

const PAGE_SIZE = 100;
const ROW_HEIGHT = 40;

interface Filters {
  q: string;
  folder: string;
  type: CaseType | "";
  priority: CasePriority | "";
  automation_status: AutomationStatus | "";
}

export function CasesPage() {
  const projectId = useCurrentProjectId();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    q: "",
    folder: "",
    type: "",
    priority: "",
    automation_status: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFolder, setBulkFolder] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useApi<Paginated<TestCase>>(
    () =>
      api.get(
        `/projects/${projectId}/cases${buildQuery({
          page,
          pageSize: PAGE_SIZE,
          ...filters,
        })}`,
      ),
    [projectId, page, filters],
  );

  const folders = useMemo(() => {
    const set = new Set<string>();
    data?.items.forEach((c) => {
      if (c.folderPath) {
        const parts = c.folderPath.split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
          set.add("/" + parts.slice(0, i).join("/"));
        }
      }
    });
    return Array.from(set).sort();
  }, [data]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const items = data?.items ?? [];
  const { start, end, onScroll } = useVirtualRows({
    count: items.length,
    rowHeight: ROW_HEIGHT,
    containerRef: scrollRef as React.RefObject<HTMLElement>,
  });
  const visible = items.slice(start, end);

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const runBulk = async () => {
    setBusy(true);
    try {
      const tags = bulkTags
        ? bulkTags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const action = bulkFolder.trim() ? "move" : tags.length ? "tag" : null;
      await api.post(`/cases/bulk`, {
        projectId,
        caseIds: Array.from(selected),
        action,
        folderPath: bulkFolder.trim() || undefined,
        tags: tags.length ? tags : undefined,
      });
      success("Bulk update applied", `${selected.size} case(s) updated`);
      setBulkOpen(false);
      setSelected(new Set());
      reload();
    } catch (err) {
      toastError("Bulk update failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = () =>
    setFilters({ q: "", folder: "", type: "", priority: "", automation_status: "" });

  return (
    <>
      <PageHeader
        title="Test Case Repository"
        actions={
          can("author_cases") ? (
            <Button variant="primary" icon={<IconFolder />} onClick={() => navigate("/cases/new")}>
              New case
            </Button>
          ) : null
        }
      />
      <div className="content" style={{ paddingTop: "var(--space-4)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: "var(--space-4)" }}>
          <div className="panel" style={{ alignSelf: "start", maxHeight: "calc(100vh - 200px)", overflow: "auto" }}>
            <div className="panel__header">
              <h2 className="panel__title" style={{ fontSize: "var(--font-md)" }}>
                Folders
              </h2>
            </div>
            <div className="panel__body" style={{ padding: "var(--space-2)" }}>
              <button
                className={`nav-link${filters.folder === "" ? " active" : ""}`}
                onClick={() => setFilters((f) => ({ ...f, folder: "" }))}
                style={{ width: "100%" }}
              >
                All cases
              </button>
              {folders.map((folder) => (
                <button
                  key={folder}
                  className={`nav-link${filters.folder === folder ? " active" : ""}`}
                  onClick={() => setFilters((f) => ({ ...f, folder }))}
                  style={{ width: "100%" }}
                >
                  <IconFolder width={14} height={14} />
                  <span className="truncate">{folder}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="panel" style={{ marginBottom: "var(--space-3)" }}>
              <div className="panel__body flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <div className="field" style={{ flex: 2, minWidth: 200, gap: 0 }}>
                  <label className="sr-only" htmlFor="case-search">
                    Search cases
                  </label>
                  <div style={{ position: "relative" }}>
                    <IconSearch
                      width={14}
                      height={14}
                      style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-textMuted)" }}
                    />
                    <input
                      id="case-search"
                      className="input"
                      style={{ paddingLeft: 30 }}
                      placeholder="Search title, ref, tag…"
                      value={filters.q}
                      onChange={(e) => {
                        setFilters((f) => ({ ...f, q: e.target.value }));
                        setPage(1);
                      }}
                    />
                  </div>
                </div>
                <select
                  className="select"
                  style={{ width: 140 }}
                  value={filters.type}
                  aria-label="Filter by type"
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, type: e.target.value as CaseType }));
                    setPage(1);
                  }}
                >
                  <option value="">All types</option>
                  {["functional", "regression", "smoke", "integration", "e2e", "performance", "security"].map((t) => (
                    <option key={t} value={t}>{titleCase(t)}</option>
                  ))}
                </select>
                <select
                  className="select"
                  style={{ width: 130 }}
                  value={filters.priority}
                  aria-label="Filter by priority"
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, priority: e.target.value as CasePriority }));
                    setPage(1);
                  }}
                >
                  <option value="">All priorities</option>
                  {["low", "medium", "high", "critical"].map((p) => (
                    <option key={p} value={p}>{titleCase(p)}</option>
                  ))}
                </select>
                <select
                  className="select"
                  style={{ width: 150 }}
                  value={filters.automation_status}
                  aria-label="Filter by automation"
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, automation_status: e.target.value as AutomationStatus }));
                    setPage(1);
                  }}
                >
                  <option value="">Any automation</option>
                  {["manual", "automated", "candidate"].map((a) => (
                    <option key={a} value={a}>{titleCase(a)}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
                {selected.size > 0 ? (
                  <Button size="sm" variant="primary" onClick={() => setBulkOpen(true)}>
                    Bulk actions ({selected.size})
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: "calc(100vh - 280px)" }}>
              <div
                ref={scrollRef}
                onScroll={onScroll}
                style={{ maxHeight: "calc(100vh - 280px)", overflow: "auto" }}
              >
                {loading ? <LoadingState /> : null}
                {error ? <ErrorState error={error} onRetry={reload} /> : null}
                {data && items.length === 0 ? (
                  <EmptyState title="No cases match" hint="Try clearing filters or create a case." />
                ) : null}
                {data && items.length > 0 ? (
                  <table className="table table--dense">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            aria-label="Select all"
                            checked={items.length > 0 && selected.size === items.length}
                            onChange={toggleAll}
                          />
                        </th>
                        <th>Ref</th>
                        <th>Title</th>
                        <th>Folder</th>
                        <th>Type</th>
                        <th>Priority</th>
                        <th>Automation</th>
                        <th>Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ height: start * ROW_HEIGHT }} aria-hidden />
                      {visible.map((c) => (
                        <tr
                          key={c.id}
                          className="clickable"
                          onClick={() => navigate(`/cases/${c.id}`)}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="checkbox"
                              aria-label={`Select ${c.ref}`}
                              checked={selected.has(c.id)}
                              onChange={() => toggle(c.id)}
                            />
                          </td>
                          <td className="mono">
                            <Link to={`/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                              {c.ref}
                            </Link>
                          </td>
                          <td className="truncate" style={{ maxWidth: 320 }}>
                            {c.title}
                          </td>
                          <td className="mono text-muted">{c.folderPath || "/"}</td>
                          <td>{titleCase(c.type)}</td>
                          <td>
                            <PriorityBadge priority={c.priority} />
                          </td>
                          <td>
                            <AutomationBadge status={c.automationStatus} />
                          </td>
                          <td className="mono">v{c.currentVersion}</td>
                        </tr>
                      ))}
                      <tr style={{ height: Math.max(0, (items.length - end) * ROW_HEIGHT) }} aria-hidden />
                    </tbody>
                  </table>
                ) : null}
              </div>
            </div>

            {data ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
            ) : null}
          </div>
        </div>

        <Modal
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title={`Bulk actions — ${selected.size} case(s)`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setBulkOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={runBulk}>
                Apply
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Move to folder" help="Leave blank to keep current folder.">
              <input
                className="input"
                placeholder="/smoke"
                value={bulkFolder}
                onChange={(e) => setBulkFolder(e.target.value)}
              />
            </Field>
            <Field label="Add tags" help="Comma-separated.">
              <input
                className="input"
                placeholder="critical-path, p0"
                value={bulkTags}
                onChange={(e) => setBulkTags(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      </div>
    </>
  );
}
