/**
 * prescriptions routes — назначения / рецепты.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, insert, run } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'
import { encryptField, decryptField } from '../lib/crypto'
import { decFieldsAll } from '../lib/enc-fields'

const prescriptions = new Hono<AppEnv>()

const ENC_FIELDS = ['medication', 'dosage', 'instructions']

const SELECT_RX = `
  SELECT rx.id, rx.patient_id, rx.doctor_id, rx.record_id, rx.medication, rx.dosage,
         rx.instructions, rx.issued_at, rx.expires_at, rx.status,
         p.patient_no, p.full_name AS patient_name_enc,
         u.full_name AS doctor_name
    FROM prescriptions rx
    JOIN patients p ON p.id = rx.patient_id
    JOIN doctors d  ON d.id = rx.doctor_id
    JOIN users u    ON u.id = d.user_id`

function scopeForUser(user: NonNullable<AppEnv['Variables']['user']>): [string, unknown[]] {
  if (hasPermission(user, 'prescriptions.view.all')) return ['1=1', []]
  if (hasPermission(user, 'prescriptions.view.department')) {
    if (user.department_id) return ['d.department_id = ?', [user.department_id]]
    return ['1=0', []]
  }
  if (user.patient_id) return ['rx.patient_id = ?', [user.patient_id]]
  return ['1=0', []]
}

prescriptions.get('/', async (c) => {
  const user = c.get('user')!
  const { page, perPage, offset } = paginate(c)
  const patientId = int(c.req.query('patient_id'))

  const [scopeSql, scopeParams] = scopeForUser(user)
  const where: string[] = [scopeSql]
  const params: unknown[] = [...scopeParams]
  if (patientId) {
    where.push('rx.patient_id = ?')
    params.push(patientId)
  }
  const whereSql = where.join(' AND ')

  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM prescriptions rx JOIN doctors d ON d.id = rx.doctor_id WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_RX} WHERE ${whereSql} ORDER BY rx.issued_at DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  const data = await decFieldsAll(c.env.APP_SECRET, rows, ENC_FIELDS)
  for (const r of data) {
    r.patient_name = await decryptField(r.patient_name_enc as string, c.env.APP_SECRET)
    delete r.patient_name_enc
  }
  return ok(c, { items: data, total: total?.n ?? 0, page, perPage })
})

prescriptions.post('/', requirePermission('prescriptions.create'), async (c) => {
  const user = c.get('user')!
  if (!user.doctor_id) return fail(c, 'forbidden', 'Только врач может выписать назначение', 403)
  const body = await c.req.json().catch(() => ({}))
  const patientId = int(body.patient_id)
  const medication = str(body.medication)
  if (!patientId) return fail(c, 'validation', 'Укажите patient_id', 400)
  if (!medication) return fail(c, 'validation', 'Укажите препарат', 400)

  const id = await insert(
    c.env.DB,
    `INSERT INTO prescriptions (patient_id, doctor_id, record_id, medication, dosage, instructions, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      patientId,
      user.doctor_id,
      int(body.record_id),
      await encryptField(medication, c.env.APP_SECRET),
      await encryptField(optStr(body.dosage) ?? '', c.env.APP_SECRET),
      await encryptField(optStr(body.instructions) ?? '', c.env.APP_SECRET),
      optStr(body.expires_at),
    ]
  )
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'prescriptions.create',
    entity_type: 'prescription',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

prescriptions.patch('/:id', requirePermission('prescriptions.create'), async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const body = await c.req.json().catch(() => ({}))
  const status = str(body.status)
  const allowed = ['active', 'completed', 'cancelled']
  if (!allowed.includes(status)) return fail(c, 'validation', 'Недопустимый статус', 400)

  await run(c.env.DB, `UPDATE prescriptions SET status = ? WHERE id = ?`, [status, id])
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'prescriptions.update',
    entity_type: 'prescription',
    entity_id: id,
    details: status,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

export default prescriptions
