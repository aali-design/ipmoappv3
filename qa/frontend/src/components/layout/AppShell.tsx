import { NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useProject } from "@/lib/project";
import { roleLabels } from "@/lib/rbac";
import { can } from "@/lib/rbac";
import {
  IconAdmin,
  IconBug,
  IconCases,
  IconDashboard,
  IconFlaky,
  IconLogout,
  IconRelease,
  IconRun,
  IconSuites,
  IconTrace,
} from "@/components/ui";
import { LoadingState } from "@/components/ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  section: string;
  visible?: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { projects, currentProject, setCurrentProject, loading: projectsLoading } =
    useProject();
  const navigate = useNavigate();
  const role = user?.role ?? "viewer";

  if (projectsLoading) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LoadingState label="Loading workspace…" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="state">
          <p className="state__title">No projects yet</p>
          <p className="state__hint">
            Create your first project to start authoring test cases and running tests.
          </p>
        </div>
      </div>
    );
  }

  const items: NavItem[] = [
    { to: "/", label: "Dashboard", icon: <IconDashboard />, section: "Overview", visible: true },
    { to: "/cases", label: "Test Cases", icon: <IconCases />, section: "Quality" },
    { to: "/suites", label: "Suites & Plans", icon: <IconSuites />, section: "Quality" },
    { to: "/runs", label: "Test Runs", icon: <IconRun />, section: "Execution" },
    { to: "/defects", label: "Defects", icon: <IconBug />, section: "Execution" },
    { to: "/triage", label: "Triage", icon: <IconTrace />, section: "Execution" },
    { to: "/flaky", label: "Flaky Queue", icon: <IconFlaky />, section: "Intelligence" },
    { to: "/traceability", label: "Traceability", icon: <IconTrace />, section: "Intelligence" },
    { to: "/releases", label: "Releases", icon: <IconRelease />, section: "Release", visible: true },
    { to: "/admin", label: "Admin", icon: <IconAdmin />, section: "Settings", visible: can(role, "manage_project") },
  ];

  const sections = Array.from(new Set(items.map((i) => i.section)));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">Q</span>
          <span className="sidebar__brand-name">QA Console</span>
        </div>
        <div className="sidebar__project">
          <span className="text-xs text-muted">Project</span>
          <select
            className="select"
            style={{ marginTop: "var(--space-1)", padding: "var(--space-1) var(--space-2)" }}
            value={currentProject?.id ?? ""}
            onChange={(e) => setCurrentProject(e.target.value)}
            aria-label="Select project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <nav className="sidebar__nav" aria-label="Primary">
          {sections.map((section) => (
            <div key={section}>
              <div className="nav-section-label">{section}</div>
              {items
                .filter((i) => i.section === section && i.visible !== false)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `nav-link${isActive ? " active" : ""}`
                    }
                  >
                    <span className="nav-link__icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="user-chip" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "var(--color-accentMuted)",
                color: "var(--color-accentText)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {(user?.fullName?.[0] ?? "?").toUpperCase()}
            </span>
            <div className="user-chip__info" style={{ minWidth: 0 }}>
              <div className="truncate font-semibold" style={{ fontSize: 12 }}>
                {user?.fullName ?? "—"}
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {roleLabels[user?.role ?? "viewer"]}
              </div>
            </div>
          </div>
          <button
            className="btn btn--ghost btn--icon ml-auto"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            aria-label="Sign out"
            title="Sign out"
          >
            <IconLogout />
          </button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
