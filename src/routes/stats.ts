/**
 * stats routes — аналитика по пациентам и врачам.
 *
 * All aggregation is performed in SQL over non-encrypted columns
 * (counts, dates, icd_code, flags, gender, birth_year). Sensitive free text
 * is never aggregated in the clear.
 *
 * Scope:
 *   patient -> own activity only
 *   doctor  -> own + department
 *   head    -> department
 *   chief   -> whole clinic
 *   admin   -> whole clinic (operational, no diagnoses)
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first } from '../lib/db'
import { ok, fail, int, str } from '../lib/http'
import { hasPermission } from '../lib/rbac'

const stats = new Hono<AppEnv>()

function rangeFromQuery(c: { req: { query: (k: string) => string | undefined } }): {
  days: number
  from: string
} {
  const raw = str(c.req.query('range')) || '30d'
  const days = raw === '7d' ? 7 : raw === '90d' ? 90 : raw === '365d' ? 365 : 30
  return { days, from: `-${days} days` }
}

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------
stats.get('/summary', async (c) => {
  const user = c.get('user')!
  const { from } = rangeFromQuery(c)

  const canSeeAll = hasPermission(user, 'stats.patients.all')
  const canSeeDept = hasPermission(user, 'stats.patients.department')
  const deptId = user.department_id ?? null

  // --- patient-scoped ---
  if (user.patient_id && !canSeeAll && !canSeeDept) {
    const pid = user.patient_id
    const upcoming = await first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM appointments
        WHERE patient_id = ? AND status IN ('scheduled','confirmed') AND scheduled_at >= datetime('now')`,
      [pid]
    )
    const visits = await first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM medical_records WHERE patient_id = ?`,
      [pid]
    )
    const analyses = await first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM analyses WHERE patient_id = ?`,
      [pid]
    )
    const abnormal = await first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM analysis_results ar
         JOIN analyses an ON an.id = ar.analysis_id
        WHERE an.patient_id = ? AND ar.flag IN ('low','high','abnormal')`,
      [pid]
    )
    return ok(c, {
      scope: 'self',
      upcoming: upcoming?.n ?? 0,
      visits: visits?.n ?? 0,
      analyses: analyses?.n ?? 0,
      abnormalResults: abnormal?.n ?? 0,
    })
  }

  // --- department / clinic scoped ---
  const deptFilter = canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'
  const deptParams = canSeeAll ? [] : deptId ? [deptId] : []

  const patients = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM patients WHERE status = 'active'`
  )
  const doctors = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM doctors d WHERE d.status = 'active' ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}`,
    deptParams
  )
  const appointmentsRange = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.scheduled_at >= datetime('now', ?) ${deptFilter}`,
    [from, ...deptParams]
  )
  const completed = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.status = 'completed' AND a.scheduled_at >= datetime('now', ?) ${deptFilter}`,
    [from, ...deptParams]
  )
  const noShow = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.status = 'no_show' AND a.scheduled_at >= datetime('now', ?) ${deptFilter}`,
    [from, ...deptParams]
  )
  const analysesPending = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM analyses an
       JOIN doctors d ON d.id = an.doctor_id
      WHERE an.status IN ('ordered','in_progress') ${deptFilter}`,
    deptParams
  )

  const total = appointmentsRange?.n ?? 0
  const done = completed?.n ?? 0
  return ok(c, {
    scope: canSeeAll ? 'all' : 'department',
    patients: patients?.n ?? 0,
    doctors: doctors?.n ?? 0,
    appointments: total,
    completed: done,
    completionRate: total ? Math.round((done / total) * 100) : 0,
    noShow: noShow?.n ?? 0,
    analysesPending: analysesPending?.n ?? 0,
    rangeDays: { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[
      (str(c.req.query('range')) || '30d') as '7d' | '30d' | '90d' | '365d'
    ] ?? 30,
  })
})

// ---------------------------------------------------------------------------
// Patient statistics
// ---------------------------------------------------------------------------
stats.get('/patients', async (c) => {
  const user = c.get('user')!
  if (
    !hasPermission(user, 'stats.patients.all') &&
    !hasPermission(user, 'stats.patients.department')
  ) {
    return fail(c, 'forbidden', 'Нет доступа к статистике пациентов', 403)
  }
  const canSeeAll = hasPermission(user, 'stats.patients.all')
  const deptId = user.department_id ?? null
  const { from, days } = rangeFromQuery(c)

  // Gender split (non-sensitive).
  const gender = await all<{ gender: string; n: number }>(
    c.env.DB,
    `SELECT COALESCE(gender,'unknown') AS gender, COUNT(*) AS n
       FROM patients GROUP BY gender`
  )

  // Age buckets from non-sensitive birth_year.
  const y = new Date().getUTCFullYear()
  const ageRows = await all<{ bucket: string; n: number }>(
    c.env.DB,
    `SELECT
        CASE
          WHEN birth_year IS NULL THEN 'unknown'
          WHEN (? - birth_year) < 18 THEN '0-17'
          WHEN (? - birth_year) < 36 THEN '18-35'
          WHEN (? - birth_year) < 60 THEN '36-59'
          ELSE '60+'
        END AS bucket,
        COUNT(*) AS n
       FROM patients GROUP BY bucket`,
    [y, y, y]
  )

  // Visits per day (encrypted diagnoses are not touched).
  const visitsSeries = await all<{ day: string; n: number }>(
    c.env.DB,
    `SELECT date(r.visit_date) AS day, COUNT(*) AS n
       FROM medical_records r
       JOIN doctors d ON d.id = r.doctor_id
      WHERE r.visit_date >= datetime('now', ?) ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY day ORDER BY day`,
    [from, ...(canSeeAll ? [] : deptId ? [deptId] : [])]
  )

  // Top diagnoses by ICD code (code is non-sensitive).
  const diagnoses = await all<{ icd_code: string; n: number }>(
    c.env.DB,
    `SELECT r.icd_code, COUNT(*) AS n
       FROM medical_records r
       JOIN doctors d ON d.id = r.doctor_id
      WHERE r.icd_code IS NOT NULL AND r.icd_code <> ''
        ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY r.icd_code ORDER BY n DESC LIMIT 10`,
    canSeeAll ? [] : deptId ? [deptId] : []
  )

  // Analysis results by flag.
  const flags = await all<{ flag: string; n: number }>(
    c.env.DB,
    `SELECT COALESCE(ar.flag,'unknown') AS flag, COUNT(*) AS n
       FROM analysis_results ar
       JOIN analyses an ON an.id = ar.analysis_id
       JOIN doctors d ON d.id = an.doctor_id
      WHERE 1=1 ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY flag`,
    canSeeAll ? [] : deptId ? [deptId] : []
  )

  // Repeat patients (more than one visit in the period).
  const repeat = await all<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM (
        SELECT r.patient_id
          FROM medical_records r
          JOIN doctors d ON d.id = r.doctor_id
         WHERE r.visit_date >= datetime('now', ?) ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
         GROUP BY r.patient_id HAVING COUNT(*) > 1)`,
    [from, ...(canSeeAll ? [] : deptId ? [deptId] : [])]
  )

  return ok(c, {
    rangeDays: days,
    gender,
    ageBuckets: ageRows,
    visitsSeries,
    diagnoses,
    flags,
    repeatPatients: repeat[0]?.n ?? 0,
  })
})

// ---------------------------------------------------------------------------
// Doctor statistics
// ---------------------------------------------------------------------------
stats.get('/doctors', async (c) => {
  const user = c.get('user')!
  if (!hasPermission(user, 'stats.doctors.all') && !hasPermission(user, 'stats.doctors.department')) {
    return fail(c, 'forbidden', 'Нет доступа к статистике врачей', 403)
  }
  const canSeeAll = hasPermission(user, 'stats.doctors.all')
  const deptId = user.department_id ?? null
  const { from, days } = rangeFromQuery(c)
  const deptParams = canSeeAll ? [] : deptId ? [deptId] : []

  const workload = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT d.id AS doctor_id, u.full_name AS doctor_name, dep.name AS department_name,
            COUNT(a.id) AS total,
            SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN a.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN a.status='no_show' THEN 1 ELSE 0 END) AS no_show
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN departments dep ON dep.id = d.department_id
       LEFT JOIN appointments a ON a.doctor_id = d.id AND a.scheduled_at >= datetime('now', ?)
      WHERE 1=1 ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY d.id ORDER BY total DESC`,
    [from, ...deptParams]
  )

  const recordsPerDoctor = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT d.id AS doctor_id, COUNT(r.id) AS records
       FROM doctors d
       LEFT JOIN medical_records r ON r.doctor_id = d.id AND r.visit_date >= datetime('now', ?)
      WHERE 1=1 ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY d.id`,
    [from, ...deptParams]
  )

  const analysesPerDoctor = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT d.id AS doctor_id, COUNT(an.id) AS analyses
       FROM doctors d
       LEFT JOIN analyses an ON an.doctor_id = d.id AND an.ordered_at >= datetime('now', ?)
      WHERE 1=1 ${canSeeAll ? '' : deptId ? 'AND d.department_id = ?' : 'AND 1=0'}
      GROUP BY d.id`,
    [from, ...deptParams]
  )

  const byDept = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT dep.name AS department_name, COUNT(DISTINCT d.id) AS doctors
       FROM departments dep
       LEFT JOIN doctors d ON d.department_id = dep.id
      GROUP BY dep.id ORDER BY doctors DESC`
  )

  return ok(c, { rangeDays: days, workload, recordsPerDoctor, analysesPerDoctor, byDept })
})

// ---------------------------------------------------------------------------
// Audit-backed activity (last N days) for a chart
// ---------------------------------------------------------------------------
stats.get('/activity', async (c) => {
  const user = c.get('user')!
  if (!hasPermission(user, 'stats.patients.all') && !hasPermission(user, 'stats.patients.department')) {
    return fail(c, 'forbidden', 'Нет доступа', 403)
  }
  const { from, days } = rangeFromQuery(c)
  const rows = await all<{ day: string; n: number }>(
    c.env.DB,
    `SELECT date(created_at) AS day, COUNT(*) AS n
       FROM audit_log WHERE created_at >= datetime('now', ?)
      GROUP BY day ORDER BY day`,
    [from]
  )
  return ok(c, { rangeDays: days, series: rows })
})

export default stats
