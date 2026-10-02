/**
 * records routes — приёмы (медкарта): жалобы, диагноз, лечение, показатели.
 *
 * Sensitive free-text columns are AES-GCM encrypted at rest.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, insert, run } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'
import { encryptField, decryptField } from '../lib/crypto'
import { decFieldsAll } from '../lib/enc-fields'

const records = new Hono<AppEnv>()

const ENC_FIELDS = ['complaints', 'diagnosis', 'treatment', 'recommendation', 'vitals']

const SELECT_RECORD = `
  SELECT r.id, r.patient_id, r.doctor_id, r.appointment_id, r.visit_date,
         r.complaints, r.diagnosis, r.icd_code, r.treatment, r.recommendation, r.vitals,
         r.created_at,
         p.patient_no, p.full_name AS patient_name_enc,
         u.full_name AS doctor_name, dep.name AS department_name
    FROM medical_records r
    JOIN patients p ON p.id = r.patient_id
    JOIN doctors d  ON d.id = r.doctor_id
    JOIN users u    ON u.id = d.user_id
    LEFT JOIN departments dep ON dep.id = d.department_id`

function scopeForUser(user: NonNullable<AppEnv['Variables']['user']>): [string, unknown[]] {
  if (hasPermission(user, 'records.view.all')) return ['1=1', []]
  if (hasPermission(user, 'records.view.department')) {
    if (user.department_id) return ['d.department_id = ?', [user.department_id]]
    return ['1=0', []]
  }
  if (user.patient_id) return ['r.patient_id = ?', [user.patient_id]]
  return ['1=0', []]
}

records.get('/', async (c) => {
  const user = c.get('user')!
  const { page, perPage, offset } = paginate(c)
  const patientId = int(c.req.query('patient_id'))

  const [scopeSql, scopeParams] = scopeForUser(user)
  const where: string[] = [scopeSql]
  const params: unknown[] = [...scopeParams]
  if (patientId) {
    where.push('r.patient_id = ?')
    params.push(patientId)
  }
  const whereSql = where.join(' AND ')

  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM medical_records r JOIN doctors d ON d.id = r.doctor_id WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_RECORD} WHERE ${whereSql} ORDER BY r.visit_date DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  const data = await decFieldsAll(c.env.APP_SECRET, rows, ENC_FIELDS)
  for (const r of data) {
    r.patient_name = await decryptField(r.patient_name_enc as string, c.env.APP_SECRET)
    delete r.patient_name_enc
  }
  return ok(c, { items: data, total: total?.n ?? 0, page, perPage })
})

records.get('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const [scopeSql, scopeParams] = scopeForUser(user)
  const row = await first<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_RECORD} WHERE r.id = ? AND ${scopeSql}`,
    [id, ...scopeParams]
  )
  if (!row) {
    await audit(c.env.DB, {
      user_id: user.id,
      username: user.username,
      action: 'records.view.denied',
      entity_type: 'medical_record',
      entity_id: id,
      ip: clientIp(c),
    })
    return fail(c, 'forbidden', 'Нет доступа к приёму', 403)
  }
  const data = await decFieldsAll(c.env.APP_SECRET, [row], ENC_FIELDS)
  const rec = data[0]
  rec.patient_name = await decryptField(rec.patient_name_enc as string, c.env.APP_SECRET)
  delete rec.patient_name_enc
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'records.view',
    entity_type: 'medical_record',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, rec)
})

records.post('/', requirePermission('records.create'), async (c) => {
  const user = c.get('user')!
  if (!user.doctor_id) return fail(c, 'forbidden', 'Только врач может вести приём', 403)
  const body = await c.req.json().catch(() => ({}))

  const patientId = int(body.patient_id)
  if (!patientId) return fail(c, 'validation', 'Укажите patient_id', 400)

  const diagnosis = str(body.diagnosis)
  const enc = {
    complaints: await encryptField(optStr(body.complaints) ?? '', c.env.APP_SECRET),
    diagnosis: await encryptField(diagnosis, c.env.APP_SECRET),
    treatment: await encryptField(optStr(body.treatment) ?? '', c.env.APP_SECRET),
    recommendation: await encryptField(optStr(body.recommendation) ?? '', c.env.APP_SECRET),
    vitals:
      body.vitals !== undefined
        ? await encryptField(
            typeof body.vitals === 'string' ? body.vitals : JSON.stringify(body.vitals),
            c.env.APP_SECRET
          )
        : '',
  }

  const id = await insert(
    c.env.DB,
    `INSERT INTO medical_records
       (patient_id, doctor_id, appointment_id, complaints, diagnosis, icd_code,
        treatment, recommendation, vitals, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      patientId,
      user.doctor_id,
      int(body.appointment_id),
      enc.complaints,
      enc.diagnosis,
      optStr(body.icd_code),
      enc.treatment,
      enc.recommendation,
      enc.vitals,
      user.id,
    ]
  )

  // If linked to an appointment, mark it completed.
  const apptId = int(body.appointment_id)
  if (apptId) {
    await run(c.env.DB, `UPDATE appointments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [apptId])
  }

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'records.create',
    entity_type: 'medical_record',
    entity_id: id,
    details: `patient=${patientId}`,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

export default records
