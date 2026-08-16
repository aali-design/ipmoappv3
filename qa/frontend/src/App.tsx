import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingState } from "@/components/ui";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { CasesPage } from "@/pages/CasesPage";
import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { SuitesPage } from "@/pages/SuitesPage";
import { RunsPage } from "@/pages/RunsPage";
import { RunWizardPage } from "@/pages/RunWizardPage";
import { RunExecutionPage } from "@/pages/RunExecutionPage";
import { DefectsPage } from "@/pages/DefectsPage";
import { TriagePage } from "@/pages/TriagePage";
import { FlakyPage } from "@/pages/FlakyPage";
import { TraceabilityPage } from "@/pages/TraceabilityPage";
import { ReleasesPage } from "@/pages/ReleasesPage";
import { AdminPage } from "@/pages/AdminPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <LoadingState label="Loading workspace…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <AppShell>{children}</AppShell>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LoginPage register />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cases"
          element={
            <RequireAuth>
              <CasesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cases/new"
          element={
            <RequireAuth>
              <CaseDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <RequireAuth>
              <CaseDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/suites"
          element={
            <RequireAuth>
              <SuitesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs"
          element={
            <RequireAuth>
              <RunsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs/new"
          element={
            <RequireAuth>
              <RunWizardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs/:id"
          element={
            <RequireAuth>
              <RunExecutionPage />
            </RequireAuth>
          }
        />
        <Route
          path="/defects"
          element={
            <RequireAuth>
              <DefectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/triage"
          element={
            <RequireAuth>
              <TriagePage />
            </RequireAuth>
          }
        />
        <Route
          path="/flaky"
          element={
            <RequireAuth>
              <FlakyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/traceability"
          element={
            <RequireAuth>
              <TraceabilityPage />
            </RequireAuth>
          }
        />
        <Route
          path="/releases"
          element={
            <RequireAuth>
              <ReleasesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
