/**
 * appointments routes — записи на приём.
 *
 * Access:
 *   patient  -> own appointments only, may self-book
 *   doctor   -> own + department appointments, may create/manage
 *   head     -> department + all
 *   chief    -> all
 *   admin    -> all (management only)
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, insert, run } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'
import { encryptField, decryptField } from '../lib/crypto'
import { decFieldsAll } from '../lib/enc-fields'

const appointments = new Hono<AppEnv>()

const SELECT_APP = `
  SELECT a.id, a.patient_id, a.doctor_id, a.department_id, a.scheduled_at,
         a.duration_min, a.type, a.status, a.reason, a.created_at, a.updated_at,
         p.patient_no, p.full_name AS patient_name_enc,
         u.full_name AS doctor_name, dep.name AS department_name,
         d.specialty
    FROM appointments a
    JOIN patients p  ON p.id = a.patient_id
    JOIN doctors d   ON d.id = a.doctor_id
    JOIN users u     ON u.id = d.user_id
    LEFT JOIN departments dep ON dep.id = a.department_id`

function scopeForUser(user: NonNullable<AppEnv['Variables']['user']>): [string, unknown[]] {
  if (hasPermission(user, 'appointments.view.all')) return ['1=1', []]
  if (hasPermission(user, 'appointments.view.department')) {
    if (user.department_id) return ['a.department_id = ?', [user.department_id]]
    return ['1=0', []]
  }
  if (user.patient_id) return ['a.patient_id = ?', [user.patient_id]]
  if (user.doctor_id) return ['a.doctor_id = ?', [user.doctor_id]]
  return ['1=0', []]
}

appointments.get('/', async (c) => {
  const user = c.get('user')!
  const { page, perPage, offset } = paginate(c)
  const status = str(c.req.query('status'))
  const from = str(c.req.query('from'))
  const to = str(c.req.query('to'))

  const [scopeSql, scopeParams] = scopeForUser(user)
  const where: string[] = [scopeSql]
  const params: unknown[] = [...scopeParams]
  if (status) {
    where.push('a.status = ?')
    params.push(status)
  }
  if (from) {
    where.push("a.scheduled_at >= datetime(?)")
    params.push(from)
  }
  if (to) {
    where.push("a.scheduled_at <= datetime(?)")
    params.push(to)
  }
  const whereSql = where.join(' AND ')

  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM appointments a WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_APP} WHERE ${whereSql} ORDER BY a.scheduled_at DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  const data = await decFieldsAll(c.env.APP_SECRET, rows, ['reason'])
  // Patient name is encrypted; decrypt it too.
  for (const r of data) {
    r.patient_name = await decryptField(r.patient_name_enc as string, c.env.APP_SECRET)
    delete r.patient_name_enc
  }
  return ok(c, { items: data, total: total?.n ?? 0, page, perPage })
})

appointments.get('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const row = await first<Record<string, unknown>>(c.env.DB, `${SELECT_APP} WHERE a.id = ?`, [id])
  if (!row) return fail(c, 'not_found', 'Запись не найдена', 404)

  const [scopeSql, scopeParams] = scopeForUser(user)
  const allowed = await first<{ ok: number }>(
    c.env.DB,
    `SELECT 1 AS ok FROM appointments a WHERE a.id = ? AND ${scopeSql}`,
    [id, ...scopeParams]
  )
  if (!allowed) return fail(c, 'forbidden', 'Нет доступа к записи', 403)

  const data = await decFieldsAll(c.env.APP_SECRET, [row], ['reason'])
  const appt = data[0]
  appt.patient_name = await decryptField(appt.patient_name_enc as string, c.env.APP_SECRET)
  delete appt.patient_name_enc
  return ok(c, appt)
})

// --- Create --------------------------------------------------------------
appointments.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))

  const canCreateForOthers = hasPermission(user, 'appointments.create')
  const canSelfBook = hasPermission(user, 'appointments.create.self')

  let patientId = int(body.patient_id)
  if (!patientId && user.patient_id && canSelfBook) patientId = user.patient_id
  if (!patientId && user.patient_id) patientId = user.patient_id
  if (!patientId) return fail(c, 'validation', 'Укажите patient_id', 400)

  // Patients may only book for themselves.
  if (!canCreateForOthers) {
    if (!user.patient_id || patientId !== user.patient_id) {
      return fail(c, 'forbidden', 'Можно записаться только на своё имя', 403)
    }
  }

  const doctorId = int(body.doctor_id)
  const scheduledAt = optStr(body.scheduled_at)
  if (!doctorId) return fail(c, 'validation', 'Выберите врача', 400)
  if (!scheduledAt) return fail(c, 'validation', 'Укажите дату и время', 400)

  const doctor = await first<{ id: number; department_id: number | null }>(
    c.env.DB,
    `SELECT id, department_id FROM doctors WHERE id = ?`,
    [doctorId]
  )
  if (!doctor) return fail(c, 'not_found', 'Врач не найден', 404)

  const durationMin = int(body.duration_min) ?? 30
  const type = str(body.type) || 'consultation'
  const reason = await encryptField(optStr(body.reason) ?? '', c.env.APP_SECRET)

  const id = await insert(
    c.env.DB,
    `INSERT INTO appointments
       (patient_id, doctor_id, department_id, scheduled_at, duration_min, type, status, reason, created_by)
     VALUES (?, ?, ?, datetime(?), ?, ?, 'scheduled', ?, ?)`,
    [patientId, doctorId, doctor.department_id, scheduledAt, durationMin, type, reason, user.id]
  )

  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'appointments.create',
    entity_type: 'appointment',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

// --- Update status -------------------------------------------------------
appointments.patch('/:id', async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)

  const appt = await first<{ id: number; patient_id: number; doctor_id: number; status: string }>(
    c.env.DB,
    `SELECT id, patient_id, doctor_id, status FROM appointments WHERE id = ?`,
    [id]
  )
  if (!appt) return fail(c, 'not_found', 'Запись не найдена', 404)

  const canManage = hasPermission(user, 'appointments.manage')
  const isOwnPatient = user.patient_id === appt.patient_id
  const isOwnDoctor = user.doctor_id === appt.doctor_id
  if (!canManage && !isOwnPatient && !isOwnDoctor) {
    return fail(c, 'forbidden', 'Нет прав на изменение записи', 403)
  }

  const body = await c.req.json().catch(() => ({}))
  const sets: string[] = []
  const params: unknown[] = []

  if (body.status !== undefined) {
    const allowed = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']
    const status = str(body.status)
    if (!allowed.includes(status)) return fail(c, 'validation', 'Недопустимый статус', 400)
    // Patients may only cancel/confirm their own booking.
    if (!canManage && !isOwnDoctor && !['cancelled', 'confirmed'].includes(status)) {
      return fail(c, 'forbidden', 'Недопустимое действие', 403)
    }
    sets.push('status = ?')
    params.push(status)
  }
  if (body.scheduled_at !== undefined && canManage) {
    sets.push('scheduled_at = datetime(?)')
    params.push(str(body.scheduled_at))
  }
  if (body.reason !== undefined && canManage) {
    sets.push('reason = ?')
    params.push(await encryptField(str(body.reason), c.env.APP_SECRET))
  }
  if (!sets.length) return ok(c, { updated: false })
  sets.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)

  await run(c.env.DB, `UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, params)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'appointments.update',
    entity_type: 'appointment',
    entity_id: id,
    details: str(body.status) || '',
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

export default appointments
