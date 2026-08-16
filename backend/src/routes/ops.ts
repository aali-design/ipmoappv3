import { Router } from 'express'
import { pool } from '../db/pool.js'
import { asyncHandler, parsePagination } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'

export const opsRouter = Router()

const startedAt = Date.now()

opsRouter.get('/health', asyncHandler(async (_req, res) => {
  let db = 'up'
  try {
    await pool.query('SELECT 1')
  } catch {
    db = 'down'
  }
  res.status(db === 'up' ? 200 : 503).json({
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    version: '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  })
}))

opsRouter.get(
  '/dashboard/summary',
  authenticate,
  asyncHandler(async (req, res) => {
    const schoolId = req.auth!.school_id

    const currentYear = await pool.query(
      `SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1`,
      [schoolId],
    )
    const yearId = currentYear.rows[0]?.id as string | undefined

    const enrolmentRes = await pool.query(
      `SELECT gl.name AS grade, count(DISTINCT e.student_id)::int AS count
         FROM enrollments e
         JOIN sections sec ON sec.id = e.section_id
         JOIN grade_levels gl ON gl.id = sec.grade_level_id
        WHERE e.left_on IS NULL AND ($1::uuid IS NULL OR e.academic_year_id = $1::uuid)
        GROUP BY gl.name, gl.sequence ORDER BY gl.sequence`,
      [yearId ?? null],
    )

    const attendanceRes = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE ar.status IN ('present','excused','sick'))::int AS present
       FROM attendance_records ar
       JOIN attendance_sessions asess ON asess.id = ar.session_id
       JOIN students s ON s.id = ar.student_id
      WHERE s.school_id = $1 AND asess.date = CURRENT_DATE`,
      [schoolId],
    )
    const totalToday = Number(attendanceRes.rows[0]?.total ?? 0)
    const presentToday = Number(attendanceRes.rows[0]?.present ?? 0)
    const todayAttendancePct = totalToday > 0 ? Math.round((presentToday / totalToday) * 10000) / 100 : null

    const feesRes = await pool.query(
      `SELECT
         COALESCE(SUM(paid_minor),0)::bigint AS collected,
         COALESCE(SUM(balance_minor),0)::bigint AS outstanding
       FROM invoices WHERE school_id = $1 AND status <> 'void' AND status <> 'draft'`,
      [schoolId],
    )
    const overdueRes = await pool.query(
      `SELECT count(*)::int AS overdue_invoices FROM invoices WHERE school_id = $1 AND status = 'overdue'`,
      [schoolId],
    )
    const studentCountRes = await pool.query(
      `SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND status = 'active'`,
      [schoolId],
    )
    const staffCountRes = await pool.query(
      `SELECT count(*)::int AS n FROM staff WHERE school_id = $1 AND is_active = true`,
      [schoolId],
    )

    const eventsRes = await pool.query(
      `SELECT title, publish_at FROM announcements WHERE school_id = $1 AND publish_at IS NOT NULL ORDER BY publish_at LIMIT 5`,
      [schoolId],
    )
    const activityRes = await pool.query(
      `SELECT action, created_at, entity_type FROM audit_log WHERE school_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [schoolId],
    )

    res.json({
      enrolment_by_grade: enrolmentRes.rows.map((r) => ({ grade: r.grade, count: r.count })),
      today_attendance_pct: todayAttendancePct,
      attendance_today: totalToday,
      fees_collected_minor: Number(feesRes.rows[0]?.collected ?? 0),
      fees_outstanding_minor: Number(feesRes.rows[0]?.outstanding ?? 0),
      overdue_invoices: Number(overdueRes.rows[0]?.overdue_invoices ?? 0),
      upcoming_events: eventsRes.rows.map((r) => ({ title: r.title, date: r.publish_at })),
      recent_activity: activityRes.rows.map((r) => ({ action: r.action, at: r.created_at, entity_type: r.entity_type })),
      student_count: Number(studentCountRes.rows[0]?.n ?? 0),
      staff_count: Number(staffCountRes.rows[0]?.n ?? 0),
    })
  }),
)

opsRouter.get(
  '/audit-log',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const pag = parsePagination(req.query, 200)
    const countRes = await pool.query(`SELECT count(*)::int AS total FROM audit_log WHERE school_id = $1`, [
      req.auth!.school_id,
    ])
    const { rows } = await pool.query(
      `SELECT a.*, u.full_name AS actor_name, u.role AS actor_role
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.school_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.auth!.school_id, pag.limit, pag.offset],
    )
    res.json({
      items: rows.map((r) => ({ ...r, actor: r.actor_name ? { full_name: r.actor_name, role: r.actor_role } : null })),
      total: Number(countRes.rows[0].total),
      page: pag.page,
      pageSize: pag.pageSize,
    })
  }),
)
