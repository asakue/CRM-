/**
 * doctors routes — directory, profiles, workload.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, run, insert } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'

const doctors = new Hono<AppEnv>()

const SELECT_DOCTOR = `
  SELECT d.id, d.user_id, d.department_id, d.specialty, d.category, d.room,
         d.cabinet_phone, d.bio, d.status,
         u.username, u.full_name, u.email,
         dep.name AS department_name, dep.code AS department_code
    FROM doctors d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN departments dep ON dep.id = d.department_id`

// --- List (all authenticated roles may see the directory) ----------------
doctors.get('/', async (c) => {
  const user = c.get('user')!
  if (!hasPermission(user, 'doctors.view.all') && !hasPermission(user, 'departments.view')) {
    return fail(c, 'forbidden', 'Нет доступа к справочнику врачей', 403)
  }
  const { page, perPage, offset } = paginate(c)
  const departmentId = int(c.req.query('department_id'))
  const where: string[] = ["d.status = 'active'"]
  const params: unknown[] = []
  if (departmentId) {
    where.push('d.department_id = ?')
    params.push(departmentId)
  }
  const whereSql = where.join(' AND ')

  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM doctors d WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `${SELECT_DOCTOR} WHERE ${whereSql} ORDER BY u.full_name LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  return ok(c, { items: rows, total: total?.n ?? 0, page, perPage })
})

// --- Single doctor -------------------------------------------------------
doctors.get('/:id', async (c) => {
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const row = await first<Record<string, unknown>>(c.env.DB, `${SELECT_DOCTOR} WHERE d.id = ?`, [id])
  if (!row) return fail(c, 'not_found', 'Врач не найден', 404)
  return ok(c, row)
})

// --- Create / link a doctor profile --------------------------------------
doctors.post('/', requirePermission('doctors.manage'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const userId = int(body.user_id)
  if (!userId) return fail(c, 'validation', 'Укажите user_id', 400)

  const existing = await first<{ id: number }>(
    c.env.DB,
    `SELECT id FROM doctors WHERE user_id = ?`,
    [userId]
  )
  if (existing) return fail(c, 'conflict', 'Профиль врача для этого пользователя уже существует', 409)

  const id = await insert(
    c.env.DB,
    `INSERT INTO doctors (user_id, department_id, specialty, category, room, cabinet_phone, bio)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      int(body.department_id),
      optStr(body.specialty),
      optStr(body.category),
      optStr(body.room),
      optStr(body.cabinet_phone),
      optStr(body.bio),
    ]
  )
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'doctors.create',
    entity_type: 'doctor',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

// --- Update a doctor profile ---------------------------------------------
doctors.put('/:id', requirePermission('doctors.manage'), async (c) => {
  const user = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const body = await c.req.json().catch(() => ({}))

  const sets: string[] = []
  const params: unknown[] = []
  const map: Record<string, string> = {
    specialty: 'specialty',
    category: 'category',
    room: 'room',
    cabinet_phone: 'cabinet_phone',
    bio: 'bio',
    status: 'status',
  }
  for (const [key, col] of Object.entries(map)) {
    if (body[key] !== undefined) {
      sets.push(`${col} = ?`)
      params.push(optStr(body[key]))
    }
  }
  if (body.department_id !== undefined) {
    sets.push('department_id = ?')
    params.push(int(body.department_id))
  }
  if (!sets.length) return ok(c, { updated: false })
  sets.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)

  await run(c.env.DB, `UPDATE doctors SET ${sets.join(', ')} WHERE id = ?`, params)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'doctors.update',
    entity_type: 'doctor',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

export default doctors
