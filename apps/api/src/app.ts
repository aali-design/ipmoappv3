import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Db } from './db'
import {
  appError,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  findUserById,
  hashPassword,
  resolveSession,
  SESSION_COOKIE,
  verifyPassword,
  type AppError,
  type SessionUser,
} from './auth'

export interface AppContext {
  db: Db
  user?: SessionUser
}

export function createApp(db: Db): Hono<{ Variables: { user: SessionUser } }> {
  const app = new Hono<{ Variables: { user: SessionUser } }>()

  app.get('/health', (c) => c.json({ ok: true, service: 'ipmo-api' }))

  const auth = new Hono<{ Variables: { user: SessionUser } }>()

  auth.post('/signup', async (c) => {
    const body = await c.req.json().catch(() => undefined)
    const { email, password } = body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw appError(400, 'invalid_body', 'email and password are required')
    }
    const normalized = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw appError(400, 'invalid_email', 'a valid email is required')
    }
    if (password.length < 8) {
      throw appError(400, 'weak_password', 'password must be at least 8 characters')
    }
    if (findUserByEmail(db, normalized)) {
      throw appError(409, 'email_taken', 'an account with this email already exists')
    }
    const userId = createUser(db, normalized, hashPassword(password))
    const token = createSession(db, userId)
    setCookie(c, SESSION_COOKIE, token, sessionCookieOptions())
    const user = findUserById(db, userId)!
    return c.json({ user: { id: user.id, email: user.email } }, 201)
  })

  auth.post('/login', async (c) => {
    const body = await c.req.json().catch(() => undefined)
    const { email, password } = body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw appError(400, 'invalid_body', 'email and password are required')
    }
    const user = findUserByEmail(db, email.trim().toLowerCase())
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw appError(401, 'invalid_credentials', 'email or password is incorrect')
    }
    const token = createSession(db, user.id)
    setCookie(c, SESSION_COOKIE, token, sessionCookieOptions())
    return c.json({ user: { id: user.id, email: user.email } })
  })

  auth.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) deleteSession(db, token)
    c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`)
    return c.json({ ok: true })
  })

  auth.get('/me', requireAuth(db), (c) => c.json({ user: c.get('user') }))

  app.route('/api/auth', auth)

  // ---- Projects ----

  const projects = new Hono<{ Variables: { user: SessionUser } }>()

  projects.get('/', requireAuth(db), (c) => {
    const user = c.get('user')
    const rows = db.raw
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p WHERE p.user_id = ? ORDER BY p.id DESC`,
      )
      .all(user.id) as { id: number; name: string; created_at: string; task_count: number }[]
    return c.json({ projects: rows.map((r) => ({ id: r.id, name: r.name, taskCount: r.task_count, createdAt: r.created_at })) })
  })

  projects.post('/', requireAuth(db), async (c) => {
    const user = c.get('user')
    const body = await c.req.json().catch(() => undefined)
    const { name } = body ?? {}
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      throw appError(400, 'invalid_name', 'name is required and must be 200 characters or fewer')
    }
    const result = db.raw.prepare('INSERT INTO projects (user_id, name) VALUES (?, ?)').run(user.id, name.trim())
    const project = getProjectForUser(db, Number(result.lastInsertRowid), user.id)
    return c.json({ project }, 201)
  })

  projects.get('/:id', requireAuth(db), (c) => {
    const user = c.get('user')
    const id = parseId(c.req.param('id'))
    const project = getProjectForUser(db, id, user.id)
    if (!project) throw appError(404, 'not_found', 'project not found')
    const tasks = db.raw
      .prepare('SELECT id, title, status, created_at FROM tasks WHERE project_id = ? ORDER BY id DESC')
      .all(project.id) as { id: number; title: string; status: string; created_at: string }[]
    return c.json({ project, tasks })
  })

  projects.patch('/:id', requireAuth(db), async (c) => {
    const user = c.get('user')
    const id = parseId(c.req.param('id'))
    if (!getProjectForUser(db, id, user.id)) throw appError(404, 'not_found', 'project not found')
    const body = await c.req.json().catch(() => undefined)
    const { name } = body ?? {}
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      throw appError(400, 'invalid_name', 'name is required and must be 200 characters or fewer')
    }
    db.raw.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name.trim(), id)
    return c.json({ project: getProjectForUser(db, id, user.id) })
  })

  projects.delete('/:id', requireAuth(db), (c) => {
    const user = c.get('user')
    const id = parseId(c.req.param('id'))
    if (!getProjectForUser(db, id, user.id)) throw appError(404, 'not_found', 'project not found')
    db.raw.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, user.id)
    return c.json({ ok: true })
  })

  app.route('/api/projects', projects)

  // ---- Tasks ----

  const tasks = new Hono<{ Variables: { user: SessionUser } }>()

  tasks.get('/projects/:projectId/tasks', requireAuth(db), (c) => {
    const user = c.get('user')
    const projectId = parseId(c.req.param('projectId'))
    if (!getProjectForUser(db, projectId, user.id)) throw appError(404, 'not_found', 'project not found')
    const rows = db.raw
      .prepare('SELECT id, title, status, created_at FROM tasks WHERE project_id = ? ORDER BY id DESC')
      .all(projectId) as { id: number; title: string; status: string; created_at: string }[]
    return c.json({ tasks: rows })
  })

  tasks.post('/projects/:projectId/tasks', requireAuth(db), async (c) => {
    const user = c.get('user')
    const projectId = parseId(c.req.param('projectId'))
    if (!getProjectForUser(db, projectId, user.id)) throw appError(404, 'not_found', 'project not found')
    const body = await c.req.json().catch(() => undefined)
    const { title } = body ?? {}
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 500) {
      throw appError(400, 'invalid_title', 'title is required and must be 500 characters or fewer')
    }
    const result = db.raw.prepare('INSERT INTO tasks (project_id, title) VALUES (?, ?)').run(projectId, title.trim())
    return c.json({ task: getTask(db, Number(result.lastInsertRowid)) }, 201)
  })

  tasks.patch('/tasks/:id', requireAuth(db), async (c) => {
    const user = c.get('user')
    const id = parseId(c.req.param('id'))
    if (!getTaskOwnedByUser(db, id, user.id)) throw appError(404, 'not_found', 'task not found')
    const body = await c.req.json().catch(() => undefined)
    const { title, status } = body ?? {}
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0 || title.length > 500) {
        throw appError(400, 'invalid_title', 'title is required and must be 500 characters or fewer')
      }
      db.raw.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(title.trim(), id)
    }
    if (status !== undefined) {
      if (typeof status !== 'string' || !['todo', 'in_progress', 'done'].includes(status)) {
        throw appError(400, 'invalid_status', 'status must be todo, in_progress, or done')
      }
      db.raw.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
    }
    return c.json({ task: getTaskOwnedByUser(db, id, user.id) })
  })

  tasks.delete('/tasks/:id', requireAuth(db), (c) => {
    const user = c.get('user')
    const id = parseId(c.req.param('id'))
    if (!getTaskOwnedByUser(db, id, user.id)) throw appError(404, 'not_found', 'task not found')
    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return c.json({ ok: true })
  })

  app.route('/api', tasks)

  app.onError((err, c) => {
    const status = typeof err === 'object' && err !== null && 'status' in err ? (err as AppError).status : 500
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as AppError).code : 'internal_error'
    const message = typeof err === 'object' && err !== null && 'message' in err ? err.message : 'internal error'
    if (status >= 500) console.error(err)
    return c.json({ error: { code, message } }, status as never)
  })

  return app
}

// ---- Helpers ----

function sessionCookieOptions(): Record<string, string> {
  return { httpOnly: 'true', sameSite: 'Lax', path: '/', secure: process.env.COOKIE_SECURE === 'true' ? 'true' : 'false' }
}

function requireAuth(db: Db) {
  return async (c: import('hono').Context<{ Variables: { user: SessionUser } }>, next: () => Promise<void>) => {
    const token = getCookie(c, SESSION_COOKIE)
    const user = token ? resolveSession(db, token) : undefined
    if (!user) throw appError(401, 'unauthorized', 'authentication required')
    c.set('user', user)
    await next()
  }
}

function parseId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw appError(400, 'invalid_id', 'invalid id')
  return id
}

interface ProjectRow {
  id: number
  name: string
  created_at: string
}

function getProjectForUser(db: Db, id: number, userId: number) {
  const row = db.raw.prepare('SELECT id, name, created_at FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as
    | ProjectRow
    | undefined
  return row ? { id: row.id, name: row.name, createdAt: row.created_at } : undefined
}

interface TaskRow {
  id: number
  project_id: number
  title: string
  status: string
  created_at: string
}

function getTask(db: Db, id: number) {
  const row = db.raw.prepare('SELECT id, project_id, title, status, created_at FROM tasks WHERE id = ?').get(id) as
    | TaskRow
    | undefined
  return row ? { id: row.id, projectId: row.project_id, title: row.title, status: row.status, createdAt: row.created_at } : undefined
}

function getTaskOwnedByUser(db: Db, id: number, userId: number) {
  const row = db.raw
    .prepare(
      `SELECT t.id, t.project_id, t.title, t.status, t.created_at
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND p.user_id = ?`,
    )
    .get(id, userId) as TaskRow | undefined
  return row ? { id: row.id, projectId: row.project_id, title: row.title, status: row.status, createdAt: row.created_at } : undefined
}