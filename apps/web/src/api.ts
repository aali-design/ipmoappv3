const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export interface User {
  id: number
  email: string
}

export interface Project {
  id: number
  name: string
  taskCount: number
  createdAt: string
}

export interface Task {
  id: number
  projectId: number
  title: string
  status: 'todo' | 'in_progress' | 'done'
  createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  const body = await res.json().catch(() => undefined)
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `request failed (${res.status})`)
  }
  return body as T
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/api/auth/me'),
  listProjects: () => request<{ projects: Project[] }>('/api/projects'),
  createProject: (name: string) =>
    request<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  listTasks: (projectId: number) => request<{ project: Project; tasks: Task[] }>(`/api/projects/${projectId}`),
  createTask: (projectId: number, title: string) =>
    request<{ task: Task }>(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify({ title }) }),
  updateTask: (taskId: number, patch: Partial<Pick<Task, 'title' | 'status'>>) =>
    request<{ task: Task }>(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}
