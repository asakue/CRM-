/**
 * patients routes — list / view / create / update / search.
 *
 * Access control (enforced server-side on every route):
 *   patient  -> only own chart
 *   doctor   -> patients of own department (via appointments/records) + all read
 *   head     -> department + all read
 *   chief    -> all
 *   admin    -> all (no clinical content beyond the chart header)
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit } from '../lib/db'
import { blindIndex } from '../lib/crypto'
import {
  createPatient,
  assignPatientNo,
  updatePatient,
  decryptPatient,
  decryptPatients,
  queryTokenHashes,
  backfillNameTokens,
} from '../lib/patient-service'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'

const patients = new Hono<AppEnv>()

const CHART_COLUMNS = `id, patient_no, user_id, full_name, full_name_hash, birth_date, gender,
  phone, email, address, blood_type, allergies, chronic_conditions, insurance_no, snils,
  notes, status, created_at, updated_at`

/** Scope rows to what the caller may see. Returns [whereSql, params]. */
function scopeForUser(user: NonNullable<AppEnv['Variables']['user']>): [string, unknown[]] {
  if (hasPermission(user, 'patients.view.all')) return ['1=1', []]
  if (hasPermission(user, 'patients.view.department') && user.doctor_id) {
    return [
      `(p.id IN (SELECT patient_id FROM appointments WHERE doctor_id = ?)
        OR p.id IN (SELECT patient_id FROM medical_records WHERE doctor_id = ?))`,
      [user.doctor_id, user.doctor_id],
    ]
  }
  if (user.patient_id) return ['p.id = ?', [user.patient_id]]
  return ['1=0', []] // no access
}

// --- List ---------------------------------------------------------------
patients.get('/', requirePermission('patients.view.self', 'patients.view.department', 'patients.view.all'), async (c) => {
  const user = c.get('user')!
  const { page, perPage, offset } = paginate(c)
  const q = str(c.req.query('q'))
  const status = str(c.req.query('status'))

  const [scopeSql, scopeParams] = scopeForUser(user)
  const where: string[] = [scopeSql]
  const params: unknown[] = [...scopeParams]

  if (status) {
    where.push('p.status = ?')
    params.push(status)
  }
  if (q) {
    // Search the token blind-index (partial name match) OR the chart number.
    // Rows written before migration 0004 have NULL tokens; backfill lazily.
    await backfillNameTokens(c.env.DB, c.env.APP_SECRET)
    const hashes = await queryTokenHashes(q, c.env.APP_SECRET)
    // Query tokens are combined with AND ("иванов сергей" narrows the result),
    // and that whole group is OR-ed with a chart-number match ("P-000123").
    const nameTokenClauses = hashes.map(() => "(',' || REPLACE(p.name_tokens,' ',',') || ',') LIKE ?")
    for (const h of hashes) params.push(`%,${h},%`)
    const nameGroup = nameTokenClauses.length
      ? `(${nameTokenClauses.join(' AND ')})`
      : '0'
    where.push(`(${nameGroup} OR p.patient_no LIKE ?)`)
    params.push(`%${q}%`)
  }

  const whereSql = where.join(' AND ')
  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM patients p WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT p.${CHART_COLUMNS.split(', ').join(', p.')}
       FROM patients p
      WHERE ${whereSql}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )

  const data = await decryptPatients(rows, c.env.APP_SECRET)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'patients.list',
    details: `q=${q || '-'} count=${data.length}`,
    ip: clientIp(c),
  })
  return ok(c, { items: data, total: total?.n ?? 0, page, perPage })
})

// --- View one ------------------------------------------------------------
patients.get('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const row = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT ${CHART_COLUMNS.split(', ').map((x) => 'p.' + x.trim()).join(', ')}
       FROM patients p WHERE p.id = ?`,
    [id]
  )
  if (!row) return fail(c, 'not_found', 'Пациент не найден', 404)

  const [scopeSql, scopeParams] = scopeForUser(user)
  const allowed = await first<{ ok: number }>(
    c.env.DB,
    `SELECT 1 AS ok FROM patients p WHERE p.id = ? AND ${scopeSql}`,
    [id, ...scopeParams]
  )
  if (!allowed) {
    await audit(c.env.DB, {
      user_id: user.id,
      username: user.username,
      action: 'patients.view.denied',
      entity_type: 'patient',
      entity_id: id,
      ip: clientIp(c),
    })
    return fail(c, 'forbidden', 'Нет доступа к карте пациента', 403)
  }

  const patient = await decryptPatient(row, c.env.APP_SECRET)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'patients.view',
    entity_type: 'patient',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, patient)
})

// --- Create --------------------------------------------------------------
patients.post('/', requirePermission('patients.create'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const fullName = str(body.full_name)
  if (!fullName) return fail(c, 'validation', 'Укажите ФИО пациента', 400)

  const id = await createPatient(
    c.env.DB,
    c.env.APP_SECRET,
    {
      full_name: fullName,
      birth_date: optStr(body.birth_date),
      gender: optStr(body.gender),
      phone: optStr(body.phone),
      email: optStr(body.email),
      address: optStr(body.address),
      blood_type: optStr(body.blood_type),
      allergies: optStr(body.allergies),
      chronic_conditions: optStr(body.chronic_conditions),
      insurance_no: optStr(body.insurance_no),
      snils: optStr(body.snils),
      notes: optStr(body.notes),
    },
    user.id
  )
  const patientNo = await assignPatientNo(c.env.DB, id)

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'patients.create',
    entity_type: 'patient',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id, patient_no: patientNo }, 201)
})

// --- Update --------------------------------------------------------------
patients.put('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const own = user.patient_id === id && hasPermission(user, 'patients.edit.self')
  const canEdit =
    hasPermission(user, 'patients.edit.all') ||
    hasPermission(user, 'patients.edit.department') ||
    own
  if (!canEdit) return fail(c, 'forbidden', 'Нет прав на редактирование', 403)

  if (own && !hasPermission(user, 'patients.edit.all') && !hasPermission(user, 'patients.edit.department')) {
    // Patients may only edit contact fields.
    const body0 = await c.req.json().catch(() => ({}))
    const allowedKeys = ['phone', 'email', 'address']
    const filtered: Record<string, unknown> = {}
    for (const k of allowedKeys) if (k in body0) filtered[k] = body0[k]
    await updatePatient(c.env.DB, c.env.APP_SECRET, id, filtered as never)
  } else {
    const body = await c.req.json().catch(() => ({}))
    await updatePatient(c.env.DB, c.env.APP_SECRET, id, {
      full_name: body.full_name !== undefined ? str(body.full_name) : undefined,
      birth_date: body.birth_date !== undefined ? optStr(body.birth_date) : undefined,
      gender: body.gender !== undefined ? optStr(body.gender) : undefined,
      phone: body.phone !== undefined ? optStr(body.phone) : undefined,
      email: body.email !== undefined ? optStr(body.email) : undefined,
      address: body.address !== undefined ? optStr(body.address) : undefined,
      blood_type: body.blood_type !== undefined ? optStr(body.blood_type) : undefined,
      allergies: body.allergies !== undefined ? optStr(body.allergies) : undefined,
      chronic_conditions: body.chronic_conditions !== undefined ? optStr(body.chronic_conditions) : undefined,
      insurance_no: body.insurance_no !== undefined ? optStr(body.insurance_no) : undefined,
      snils: body.snils !== undefined ? optStr(body.snils) : undefined,
      notes: body.notes !== undefined ? optStr(body.notes) : undefined,
      status: body.status !== undefined ? optStr(body.status) ?? undefined : undefined,
    })
  }

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'patients.update',
    entity_type: 'patient',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

// --- Own chart shortcut (patients) ---------------------------------------
patients.get('/me/chart', async (c) => {
  const user = c.get('user')!
  if (!user.patient_id) return fail(c, 'not_found', 'Карта пациента не найдена', 404)
  const row = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT ${CHART_COLUMNS.split(', ').map((x) => 'p.' + x.trim()).join(', ')}
       FROM patients p WHERE p.id = ?`,
    [user.patient_id]
  )
  if (!row) return fail(c, 'not_found', 'Карта пациента не найдена', 404)
  return ok(c, await decryptPatient(row, c.env.APP_SECRET))
})

export default patients
