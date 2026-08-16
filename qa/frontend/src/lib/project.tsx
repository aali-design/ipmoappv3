import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./apiClient";
import { useAuth } from "./auth";
import type { Project } from "./types";

const PROJECT_KEY = "qa.currentProjectId";

interface ProjectContextValue {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  setCurrentProject: (id: string) => void;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(
    () => localStorage.getItem(PROJECT_KEY),
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.get<Project[]>("/projects");
      setProjects(list);
      setCurrentId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setCurrentProject = useCallback((id: string) => {
    localStorage.setItem(PROJECT_KEY, id);
    setCurrentId(id);
  }, []);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentId) ?? projects[0] ?? null,
    [projects, currentId],
  );

  const value = useMemo(
    () => ({
      projects,
      currentProject,
      loading,
      setCurrentProject,
      refresh,
    }),
    [projects, currentProject, loading, setCurrentProject, refresh],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

/** Hook returning the current project id, throwing-friendly for routes that need it. */
export function useCurrentProjectId(): string {
  const { currentProject } = useProject();
  if (!currentProject) throw new Error("No project selected");
  return currentProject.id;
}
