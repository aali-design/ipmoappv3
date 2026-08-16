import { Pool } from 'pg'
const TEST_DB = 'scholarion_test'
const base = new Pool({ connectionString: process.env.DATABASE_URL })
await base.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
await base.query(`CREATE DATABASE ${TEST_DB}`)
const u = new URL(process.env.DATABASE_URL); u.pathname = `/${TEST_DB}`
process.env.DATABASE_URL = u.toString()
const { runMigrations } = await import('./dist/db/migrate.js')
const { seedIfEmpty } = await import('./dist/db/seed.js')
const { pool } = await import('./dist/db/pool.js')
const { createApp } = await import('./dist/app.js')
await runMigrations(); await seedIfEmpty()
const q = (s,p=[]) => pool.query(s,p)
const students = (await q(`SELECT count(*)::int n FROM students`)).rows[0].n
const receipts = (await q(`SELECT receipt_no FROM payments`)).rows.map(r => Number(r.receipt_no.replace('RCT-',''))).sort((a,b)=>a-b)
const invoices = (await q(`SELECT count(*)::int n FROM invoices`)).rows[0].n
const recon = (await q(`SELECT (SELECT COALESCE(SUM(debit_minor),0)::bigint - COALESCE(SUM(credit_minor),0)::bigint FROM ledger_entries) net, (SELECT COALESCE(SUM(balance_minor),0)::bigint FROM invoices WHERE status NOT IN ('void','draft')) out`)).rows[0]
console.log('students:', students, '| invoices:', invoices, '| payments:', receipts.length)
console.log('receipts gapless from 1:', receipts.length>0 && receipts.every((n,i)=>n===i+1) && receipts.length===new Set(receipts).size)
console.log('ledger reconciles:', recon.net === recon.out)
const app = createApp(); const server = app.listen(0); const port = server.address().port
const http = await import('node:http')
const get = (p, tok) => new Promise((res,rej)=>{ http.get(`http://127.0.0.1:${port}${p}`, {headers: tok?{Authorization:`Bearer ${tok}`}:{}}, r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res({s:r.statusCode,b}))}).on('error',rej) })
const login = await new Promise((res,rej)=>{ const d=JSON.stringify({email:'admin@scholarion.local',password:'Admin12345!'}); const rq=http.request(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':d.length}},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res({s:r.statusCode,b}))}); rq.on('error',rej); rq.write(d); rq.end() })
const tok = JSON.parse(login.b).accessToken
const h = await get('/api/health')
const st = await get('/api/students?page=1&pageSize=20', tok)
console.log('health:', h.s, '| login:', login.s, '| students total:', JSON.parse(st.b).total)
server.close(); await pool.end()
await base.query(`DROP DATABASE IF EXISTS ${TEST_DB}`); await base.end()
console.log('FINAL VERIFY DONE')
