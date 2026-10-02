/**
 * departments routes.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, insert, run } from '../lib/db'
import { ok, fail, int, str, optStr } from '../lib/http'
import { requirePermission, hasPermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'

const departments = new Hono<AppEnv>()

departments.get('/', async (c) => {
  const user = c.get('user')!
  if (!hasPermission(user, 'departments.view')) {
    return fail(c, 'forbidden', 'Нет доступа', 403)
  }
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT dep.id, dep.code, dep.name, dep.description, dep.location, dep.phone,
            dep.head_user_id, u.full_name AS head_name,
            (SELECT COUNT(*) FROM doctors dc WHERE dc.department_id = dep.id AND dc.status='active') AS doctors_count,
            (SELECT COUNT(*) FROM appointments a WHERE a.department_id = dep.id) AS appointments_count
       FROM departments dep
       LEFT JOIN users u ON u.id = dep.head_user_id
      ORDER BY dep.name`
  )
  return ok(c, { items: rows })
})

departments.post('/', requirePermission('departments.manage'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const code = str(body.code).toUpperCase()
  const name = str(body.name)
  if (!code || !name) return fail(c, 'validation', 'Укажите код и название', 400)

  const exists = await first<{ id: number }>(c.env.DB, `SELECT id FROM departments WHERE code = ?`, [code])
  if (exists) return fail(c, 'conflict', 'Отделение с таким кодом уже есть', 409)

  const id = await insert(
    c.env.DB,
    `INSERT INTO departments (code, name, description, location, phone) VALUES (?, ?, ?, ?, ?)`,
    [code, name, optStr(body.description), optStr(body.location), optStr(body.phone)]
  )
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'departments.create',
    entity_type: 'department',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

departments.put('/:id', requirePermission('departments.manage'), async (c) => {
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')!

  const sets: string[] = []
  const params: unknown[] = []
  for (const key of ['name', 'description', 'location', 'phone']) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`)
      params.push(optStr(body[key]))
    }
  }
  if (body.head_user_id !== undefined) {
    sets.push('head_user_id = ?')
    params.push(int(body.head_user_id))
  }
  if (!sets.length) return ok(c, { updated: false })
  params.push(id)
  await run(c.env.DB, `UPDATE departments SET ${sets.join(', ')} WHERE id = ?`, params)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'departments.update',
    entity_type: 'department',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

export default departments
