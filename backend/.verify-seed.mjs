import { Pool } from 'pg'

const TEST_DB = 'scholarion_test'
const baseClient = new Pool({ connectionString: process.env.DATABASE_URL })

async function recreateDb() {
  await baseClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
  await baseClient.query(`CREATE DATABASE ${TEST_DB}`)
  const testUrl = new URL(process.env.DATABASE_URL)
  testUrl.pathname = `/${TEST_DB}`
  return testUrl.toString()
}

async function main() {
  const testUrl = await recreateDb()
  process.env.DATABASE_URL = testUrl

  const { runMigrations } = await import('./dist/db/migrate.js')
  const { seedIfEmpty } = await import('./dist/db/seed.js')
  const { pool } = await import('./dist/db/pool.js')
  const { createApp } = await import('./dist/app.js')
  const { verifyPassword } = await import('./dist/lib/crypto.js')

  await runMigrations()
  const seeded = await seedIfEmpty()
  console.log('seeded:', seeded, '| idempotent:', (await seedIfEmpty()) === false)

  const q = (sql, p = []) => pool.query(sql, p)

  const counts = {
    students: (await q(`SELECT count(*)::int n FROM students`)).rows[0].n,
    sections: (await q(`SELECT count(*)::int n FROM sections`)).rows[0].n,
    slots: (await q(`SELECT count(*)::int n FROM timetable_slots`)).rows[0].n,
    invoices: (await q(`SELECT count(*)::int n FROM invoices`)).rows[0].n,
    payments: (await q(`SELECT count(*)::int n FROM payments`)).rows[0].n,
    reportCards: (await q(`SELECT count(*)::int n FROM report_cards WHERE status='published'`)).rows[0].n,
  }
  console.log('counts:', JSON.stringify(counts))

  // Admin login password
  const admin = (await q(`SELECT email, password_hash FROM users WHERE role='admin' LIMIT 1`)).rows[0]
  console.log('admin:', admin.email, '| password ok:', verifyPassword('Admin12345!', admin.password_hash))

  // Receipt gaplessness (numeric)
  const receipts = (await q(`SELECT receipt_no FROM payments`)).rows.map(r => r.receipt_no.replace('RCT-','')).map(Number)
  const gapless = receipts.length > 0 && receipts.every((n, i) => n === i + 1) && receipts.length === new Set(receipts).size
  console.log('receipts:', receipts.length, 'gapless from 1:', gapless)

  // Ledger reconciliation
  const recon = (await q(`
    SELECT
      (SELECT COALESCE(SUM(debit_minor),0)::bigint - COALESCE(SUM(credit_minor),0)::bigint FROM ledger_entries) net,
      (SELECT COALESCE(SUM(balance_minor),0)::bigint FROM invoices WHERE status NOT IN ('void','draft')) outstanding
  `)).rows[0]
  console.log('ledger reconciles:', recon.net === recon.outstanding, `(net ${recon.net}, outstanding ${recon.outstanding})`)

  // Timetable conflict check with correct ctx
  const { validateTimetableSlots } = await import('./dist/engines/timetable.js')
  const ay = (await q(`SELECT id FROM academic_years WHERE is_current = true LIMIT 1`)).rows[0]
  const periods = (await q(`SELECT id, is_break, label FROM periods WHERE academic_year_id = $1`, [ay.id])).rows
  const subjects = (await q(`SELECT id, credit_hours, name, code FROM subjects`)).rows
  const staff = (await q(`SELECT id FROM staff`)).rows
  const ctx = {
    periods: new Map(periods.map(p => [p.id, { isBreak: p.is_break, label: p.label }])),
    subjects: new Map(subjects.map(s => [s.id, { creditHours: Number(s.credit_hours), name: s.name, code: s.code }])),
    staff: new Map(staff.map(s => [s.id, { maxPeriodsPerWeek: null }])),
  }
  const slots = (await q(`SELECT section_id, subject_id, teacher_id, room_id, weekday, period_id, effective_from, effective_to FROM timetable_slots WHERE academic_year_id = $1`, [ay.id])).rows
  const result = validateTimetableSlots(slots, ctx)
  const errors = result.violations.filter(v => v.severity === 'error')
  const warnings = result.violations.filter(v => v.severity === 'warning')
  console.log('timetable valid:', result.valid, '| errors:', errors.length, '| warnings:', warnings.length)
  if (errors.length) console.log('ERRORS:', errors.slice(0,5).map(e => e.code + ' ' + e.message))

  // Grade computation for one section
  const { computeSectionGrades } = await import('./dist/services/grading.js')
  const schoolId = (await q(`SELECT id FROM schools LIMIT 1`)).rows[0].id
  const sec = (await q(`SELECT id FROM sections LIMIT 1`)).rows[0].id
  const term = (await q(`SELECT id FROM terms WHERE sequence = 1 LIMIT 1`)).rows[0].id
  const grades = await computeSectionGrades(schoolId, sec, term)
  const oneStudent = grades.byStudent.values().next().value
  console.log('section grades students:', grades.byStudent.size, '| subjects per student:', oneStudent?.subjects?.length)

  // Full HTTP smoke test
  const app = createApp()
  const server = app.listen(0)
  const port = server.address().port
  const http = await import('node:http')
  const get = (path) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
  const health = await get('/api/health')
  console.log('GET /api/health:', health.status, health.body)

  const login = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ email: 'admin@scholarion.local', password: 'Admin12345!' })
    const req = http.request(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
  const loginJson = JSON.parse(login.body)
  console.log('POST /api/auth/login:', login.status, '| has accessToken:', !!loginJson.accessToken, '| role:', loginJson.user?.role)

  const students = await get('/api/students?page=1&pageSize=20')
  console.log('GET /api/students (unauthed):', students.status)

  const authGet = (path, token) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
  const studentsAuthed = await authGet('/api/students?page=1&pageSize=20', loginJson.accessToken)
  const studentsJson = JSON.parse(studentsAuthed.body)
  console.log('GET /api/students (authed):', studentsAuthed.status, '| total:', studentsJson.total)

  server.close()
  await pool.end()
  console.log('VERIFY DONE')
}

main().then(async () => {
  await baseClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => {})
  await baseClient.end()
}).catch(async (e) => {
  console.error('VERIFY FAILED:', e.message)
  try { await baseClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`) } catch {}
  try { await baseClient.end() } catch {}
  process.exit(1)
})
