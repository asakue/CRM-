/**
 * analyses routes — справочник анализов, направления и результаты.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, insert, run } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'
import { encryptField, decryptField } from '../lib/crypto'
import { decFieldsAll } from '../lib/enc-fields'

const analyses = new Hono<AppEnv>()

// --- Catalog -------------------------------------------------------------
analyses.get('/types', async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name, category, unit, ref_min, ref_max, description
       FROM analysis_types WHERE is_active = 1 ORDER BY category, name`
  )
  return ok(c, { items: rows })
})

const SELECT_ANALYSIS = `
  SELECT an.id, an.patient_id, an.doctor_id, an.type_id, an.ordered_at,
         an.performed_at, an.status,
         t.code AS type_code, t.name AS type_name, t.category, t.unit,
         t.ref_min, t.ref_max,
         p.patient_no, p.full_name AS patient_name_enc,
         u.full_name AS doctor_name, dep.name AS department_name
    FROM analyses an
    JOIN analysis_types t ON t.id = an.type_id
    JOIN patients p       ON p.id = an.patient_id
    JOIN doctors d        ON d.id = an.doctor_id
    JOIN users u          ON u.id = d.user_id
    LEFT JOIN departments dep ON dep.id = d.department_id`

function scopeForUser(user: NonNullable<AppEnv['Variables']['user']>): [string, unknown[]] {
  if (hasPermission(user, 'analyses.view.all')) return ['1=1', []]
  if (hasPermission(user, 'analyses.view.department')) {
    if (user.department_id) return ['d.department_id = ?', [user.department_id]]
    return ['1=0', []]
  }
  if (user.patient_id) return ['an.patient_id = ?', [user.patient_id]]
  return ['1=0', []]
}

// --- List ----------------------------------------------------------------
analyses.get('/', async (c) => {
  const user = c.get('user')!
  const { page, perPage, offset } = paginate(c)
  const patientId = int(c.req.query('patient_id'))
  const status = str(c.req.query('status'))

  const [scopeSql, scopeParams] = scopeForUser(user)
  const where: string[] = [scopeSql]
  const params: unknown[] = [...scopeParams]
  if (patientId) {
    where.push('an.patient_id = ?')
    params.push(patientId)
  }
  if (status) {
    where.push('an.status = ?')
    params.push(status)
  }
  const whereSql = where.join(' AND ')

  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM analyses an JOIN doctors d ON d.id = an.doctor_id WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_ANALYSIS} WHERE ${whereSql} ORDER BY an.ordered_at DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  for (const r of rows) {
    r.patient_name = await decryptField(r.patient_name_enc as string, c.env.APP_SECRET)
    delete r.patient_name_enc
  }
  return ok(c, { items: rows, total: total?.n ?? 0, page, perPage })
})

// --- One analysis + results ----------------------------------------------
analyses.get('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const [scopeSql, scopeParams] = scopeForUser(user)
  const row = await first<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_ANALYSIS} WHERE an.id = ? AND ${scopeSql}`,
    [id, ...scopeParams]
  )
  if (!row) return fail(c, 'forbidden', 'Нет доступа к анализу', 403)
  row.patient_name = await decryptField(row.patient_name_enc as string, c.env.APP_SECRET)
  delete row.patient_name_enc

  const results = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, value_numeric, value_text, flag, comment, created_at
       FROM analysis_results WHERE analysis_id = ? ORDER BY id`,
    [id]
  )
  const dec = await decFieldsAll(c.env.APP_SECRET, results, ['value_text', 'comment'])

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'analyses.view',
    entity_type: 'analysis',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { ...row, results: dec })
})

// --- Order an analysis ---------------------------------------------------
analyses.post('/', requirePermission('analyses.order'), async (c) => {
  const user = c.get('user')!
  if (!user.doctor_id) return fail(c, 'forbidden', 'Только врач может назначить анализ', 403)
  const body = await c.req.json().catch(() => ({}))
  const patientId = int(body.patient_id)
  const typeId = int(body.type_id)
  if (!patientId) return fail(c, 'validation', 'Укажите patient_id', 400)
  if (!typeId) return fail(c, 'validation', 'Укажите type_id', 400)

  const type = await first<{ id: number }>(c.env.DB, `SELECT id FROM analysis_types WHERE id = ?`, [typeId])
  if (!type) return fail(c, 'not_found', 'Тип анализа не найден', 404)

  const id = await insert(
    c.env.DB,
    `INSERT INTO analyses (patient_id, doctor_id, type_id, status, created_by)
     VALUES (?, ?, ?, 'ordered', ?)`,
    [patientId, user.doctor_id, typeId, user.id]
  )
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'analyses.order',
    entity_type: 'analysis',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

// --- Enter / update result -----------------------------------------------
analyses.post('/:id/results', requirePermission('analyses.enter'), async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const analysis = await first<{ id: number; type_id: number }>(
    c.env.DB,
    `SELECT an.id, an.type_id, t.ref_min, t.ref_max FROM analyses an
       JOIN analysis_types t ON t.id = an.type_id WHERE an.id = ?`,
    [id]
  )
  if (!analysis) return fail(c, 'not_found', 'Анализ не найден', 404)

  const body = await c.req.json().catch(() => ({}))
  const num = body.value_numeric !== undefined && body.value_numeric !== '' ? Number(body.value_numeric) : null

  // Auto-derive flag from reference range when numeric.
  let flag = optStr(body.flag)
  if (!flag && num !== null && Number.isFinite(num)) {
    const ref = await first<{ ref_min: number; ref_max: number }>(
      c.env.DB,
      `SELECT ref_min, ref_max FROM analysis_types WHERE id = ?`,
      [analysis.type_id]
    )
    if (ref && ref.ref_min != null && ref.ref_max != null) {
      flag = num < ref.ref_min ? 'low' : num > ref.ref_max ? 'high' : 'normal'
    }
  }

  const valueText = await encryptField(optStr(body.value_text) ?? '', c.env.APP_SECRET)
  const comment = await encryptField(optStr(body.comment) ?? '', c.env.APP_SECRET)

  const resultId = await insert(
    c.env.DB,
    `INSERT INTO analysis_results (analysis_id, value_numeric, value_text, flag, comment, entered_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, num !== null && Number.isFinite(num) ? num : null, valueText, flag, comment, user.id]
  )
  await run(
    c.env.DB,
    `UPDATE analyses SET status = 'completed', performed_at = COALESCE(performed_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    [id]
  )

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'analyses.result.create',
    entity_type: 'analysis',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id: resultId }, 201)
})

// --- Update analysis status ----------------------------------------------
analyses.patch('/:id', requirePermission('analyses.order', 'analyses.enter'), async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const body = await c.req.json().catch(() => ({}))
  const status = str(body.status)
  const allowed = ['ordered', 'in_progress', 'completed', 'cancelled']
  if (!allowed.includes(status)) return fail(c, 'validation', 'Недопустимый статус', 400)

  await run(c.env.DB, `UPDATE analyses SET status = ? WHERE id = ?`, [status, id])
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'analyses.update',
    entity_type: 'analysis',
    entity_id: id,
    details: status,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

export default analyses
