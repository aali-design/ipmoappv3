import { pool } from '../db/pool.js'
import type { AuthUser } from '../types.js'

/**
 * Load the full auth context for a user id, resolving relationship scope:
 *  - student  -> their own students.id
 *  - guardian -> ids of children linked in guardianships
 *  - teacher  -> their staff.id
 * Tenant (school_id) is always read from the users row — never from the request.
 */
export async function buildAuthUser(userId: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT id, school_id, email, full_name, role, is_active, last_login_at
       FROM users WHERE id = $1`,
    [userId],
  )
  const u = rows[0]
  if (!u) return null

  const authUser: AuthUser = {
    id: u.id,
    school_id: u.school_id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    is_active: u.is_active,
    last_login_at: u.last_login_at,
  }

  if (u.role === 'student') {
    const s = await pool.query(`SELECT id FROM students WHERE user_id = $1`, [userId])
    const studentId = s.rows[0]?.id as string | undefined
    authUser.student_id = studentId
    authUser.student_ids = studentId ? [studentId] : []
  } else if (u.role === 'guardian') {
    const g = await pool.query(`SELECT id FROM guardians WHERE user_id = $1`, [userId])
    const guardianId = g.rows[0]?.id as string | undefined
    if (guardianId) {
      const kids = await pool.query(
        `SELECT student_id FROM guardianships WHERE guardian_id = $1`,
        [guardianId],
      )
      authUser.student_ids = kids.rows.map((r) => r.student_id as string)
    } else {
      authUser.student_ids = []
    }
  } else if (u.role === 'teacher') {
    const st = await pool.query(`SELECT id FROM staff WHERE user_id = $1`, [userId])
    authUser.staff_id = st.rows[0]?.id as string | undefined
  }

  return authUser
}
