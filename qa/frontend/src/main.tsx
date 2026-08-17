import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { injectDesignTokens } from "@/theme/inject";
import { AuthProvider } from "@/lib/auth";
import { ProjectProvider } from "@/lib/project";
import { ToastProvider } from "@/components/ui/Toast";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { AppRouter } from "@/App";
import "@/styles.css";

injectDesignTokens();

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <ProjectProvider>
            <AppRouter />
          </ProjectProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
