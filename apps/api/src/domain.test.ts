import { describe, expect, it } from 'vitest'
import { makeTestApp, signup } from './test-utils'

describe('projects & tasks domain flow', () => {
  const { fetch } = makeTestApp()
  let aliceCookie = ''
  let bobCookie = ''

  it('signs up test users', async () => {
    aliceCookie = await signup(fetch, 'alice@ipmo.app')
    bobCookie = await signup(fetch, 'bob@ipmo.app')
    expect(aliceCookie).toMatch(/^ipmo_session=/)
    expect(bobCookie).toMatch(/^ipmo_session=/)
  })

  it('rejects project creation without auth', async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('creates a project', async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ name: 'Launch' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.project.name).toBe('Launch')
    expect(body.project.id).toBeGreaterThan(0)
  })

  it('lists projects only for the owning user', async () => {
    const aliceList = await fetch('/api/projects', { headers: { cookie: aliceCookie } })
    const aliceBody = await aliceList.json()
    expect(aliceBody.projects).toHaveLength(1)
    expect(aliceBody.projects[0].name).toBe('Launch')

    const bobList = await fetch('/api/projects', { headers: { cookie: bobCookie } })
    const bobBody = await bobList.json()
    expect(bobBody.projects).toHaveLength(0)
  })

  it('scopes project access across users', async () => {
    const projId = (await (await fetch('/api/projects', { headers: { cookie: aliceCookie } })).json()).projects[0].id
    const res = await fetch(`/api/projects/${projId}`, { headers: { cookie: bobCookie } })
    expect(res.status).toBe(404)
  })

  it('adds tasks to a project and updates status', async () => {
    const projId = (await (await fetch('/api/projects', { headers: { cookie: aliceCookie } })).json()).projects[0].id

    const addRes = await fetch(`/api/projects/${projId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ title: 'Write spec' }),
    })
    expect(addRes.status).toBe(201)
    const addBody = await addRes.json()
    expect(addBody.task.title).toBe('Write spec')
    expect(addBody.task.status).toBe('todo')
    const taskId = addBody.task.id

    const updateRes = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(updateRes.status).toBe(200)
    expect((await updateRes.json()).task.status).toBe('done')

    const project = await fetch(`/api/projects/${projId}`, { headers: { cookie: aliceCookie } })
    const projectBody = await project.json()
    expect(projectBody.tasks).toHaveLength(1)
    expect(projectBody.tasks[0].title).toBe('Write spec')
    expect(projectBody.tasks[0].status).toBe('done')
  })

  it('prevents cross-user task updates', async () => {
    const projId = (await (await fetch('/api/projects', { headers: { cookie: aliceCookie } })).json()).projects[0].id
    const taskId = (await (await fetch(`/api/projects/${projId}/tasks`, { headers: { cookie: aliceCookie } })).json()).tasks[0].id
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ status: 'todo' }),
    })
    expect(res.status).toBe(404)
  })

  it('deletes a task and a project', async () => {
    const projId = (await (await fetch('/api/projects', { headers: { cookie: aliceCookie } })).json()).projects[0].id
    const taskId = (await (await fetch(`/api/projects/${projId}/tasks`, { headers: { cookie: aliceCookie } })).json()).tasks[0].id

    const delTask = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE', headers: { cookie: aliceCookie } })
    expect(delTask.status).toBe(200)

    const delProject = await fetch(`/api/projects/${projId}`, { method: 'DELETE', headers: { cookie: aliceCookie } })
    expect(delProject.status).toBe(200)

    const list = await fetch('/api/projects', { headers: { cookie: aliceCookie } })
    expect((await list.json()).projects).toHaveLength(0)
  })

  it('rejects invalid task status', async () => {
    const projRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ name: 'Validation' }),
    })
    const projId = (await projRes.json()).project.id
    const add = await fetch(`/api/projects/${projId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ title: 't' }),
    })
    const taskId = (await add.json()).task.id
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      body: JSON.stringify({ status: 'nope' }),
    })
    expect(res.status).toBe(400)
  })
})