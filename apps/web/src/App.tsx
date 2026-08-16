import { useCallback, useEffect, useState } from 'react'
import { api, type Project, type Task, type User } from './api'

type View = 'auth' | 'app'

export function App() {
  const [view, setView] = useState<View>('auth')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user)
        setView('app')
      })
      .catch(() => setView('auth'))
  }, [])

  const handleAuthed = useCallback((user: User) => {
    setUser(user)
    setView('app')
  }, [])

  const handleLogout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setView('auth')
  }, [])

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>ipmo</h1>
      {view === 'auth' ? (
        <AuthPanel onAuthed={handleAuthed} onError={setError} />
      ) : user ? (
        <Dashboard user={user} onLogout={handleLogout} onError={setError} />
      ) : null}
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
    </main>
  )
}

function AuthPanel({ onAuthed, onError }: { onAuthed: (user: User) => void; onError: (msg: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    onError('')
    try {
      const { user } = mode === 'login' ? await api.login(email, password) : await api.signup(email, password)
      onAuthed(user)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'request failed')
    }
  }

  return (
    <section>
      <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit">{mode === 'login' ? 'Sign in' : 'Sign up'}</button>
      </form>
      <p>
        {mode === 'login' ? 'New to ipmo?' : 'Already have an account?'}{' '}
        <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </section>
  )
}

function Dashboard({ user, onLogout, onError }: { user: User; onLogout: () => void; onError: (msg: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [newName, setNewName] = useState('')
  const [newTask, setNewTask] = useState('')

  const refreshProjects = useCallback(async () => {
    const { projects } = await api.listProjects()
    setProjects(projects)
  }, [])

  const openProject = useCallback(async (project: Project) => {
    const { project: fresh, tasks } = await api.listTasks(project.id)
    setActiveProject(fresh)
    setTasks(tasks)
  }, [])

  useEffect(() => {
    refreshProjects().catch((err) => onError(err instanceof Error ? err.message : 'failed to load projects'))
  }, [refreshProjects, onError])

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const { project } = await api.createProject(newName)
    setNewName('')
    await refreshProjects()
    await openProject(project)
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProject || !newTask.trim()) return
    await api.createTask(activeProject.id, newTask)
    setNewTask('')
    await openProject(activeProject)
  }

  async function toggleTask(task: Task) {
    const next = task.status === 'done' ? 'todo' : 'done'
    await api.updateTask(task.id, { status: next })
    if (activeProject) await openProject(activeProject)
    await refreshProjects()
  }

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Your workspace</h2>
        <div>
          <span>{user.email}</span>{' '}
          <button type="button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <form onSubmit={createProject}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New project name" required />
        <button type="submit">Create project</button>
      </form>

      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => openProject(p)}>
              {p.name} ({p.taskCount})
            </button>
          </li>
        ))}
      </ul>

      {activeProject && (
        <section>
          <h3>{activeProject.name}</h3>
          <form onSubmit={createTask}>
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="New task title" required />
            <button type="submit">Add task</button>
          </form>
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <label>
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t)} />
                  <span style={t.status === 'done' ? { textDecoration: 'line-through' } : undefined}>{t.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
