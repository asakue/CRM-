/**
 * admin routes — users, roles and audit log (admin & chief only where noted).
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, audit, run, insert } from '../lib/db'
import { ok, fail, paginate, str, optStr, int } from '../lib/http'
import { requirePermission } from '../lib/rbac'
import { clientIp } from '../lib/middleware'
import { createUser, setPassword, revokeAllSessions } from '../lib/auth'
import type { RoleCode } from '../types'

const admin = new Hono<AppEnv>()

const ROLES: RoleCode[] = ['patient', 'doctor', 'head', 'chief', 'admin']

// --- Users list ----------------------------------------------------------
admin.get('/users', requirePermission('admin.users'), async (c) => {
  const { page, perPage, offset } = paginate(c)
  const q = str(c.req.query('q'))
  const where: string[] = ['1=1']
  const params: unknown[] = []
  if (q) {
    where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const whereSql = where.join(' AND ')
  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM users u WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT u.id, u.username, u.email, u.full_name, u.status, u.role_id,
            r.code AS role, r.name AS role_name, u.must_change_password,
            u.failed_attempts, u.locked_until, u.last_login_at, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  return ok(c, { items: rows, total: total?.n ?? 0, page, perPage })
})

// --- Create user ---------------------------------------------------------
admin.post('/users', requirePermission('admin.users'), async (c) => {
  const actor = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const username = str(body.username)
  const password = str(body.password)
  const role = str(body.role) as RoleCode

  if (username.length < 3) return fail(c, 'validation', 'Логин не короче 3 символов', 400)
  if (password.length < 8) return fail(c, 'validation', 'Пароль не короче 8 символов', 400)
  if (!ROLES.includes(role)) return fail(c, 'validation', 'Недопустимая роль', 400)

  const exists = await first<{ id: number }>(c.env.DB, `SELECT id FROM users WHERE username = ?`, [username])
  if (exists) return fail(c, 'conflict', 'Логин занят', 409)

  const id = await createUser(c.env.DB, {
    username,
    password,
    roleCode: role,
    full_name: optStr(body.full_name) ?? undefined,
    email: optStr(body.email) ?? undefined,
    mustChangePassword: body.must_change_password === true,
  })

  await audit(c.env.DB, {
    user_id: actor.id,
    username: actor.username,
    action: 'admin.users.create',
    entity_type: 'user',
    entity_id: id,
    details: `role=${role}`,
    ip: clientIp(c),
  })
  return ok(c, { id }, 201)
})

// --- Update user (status / role / reset password) ------------------------
admin.patch('/users/:id', requirePermission('admin.users'), async (c) => {
  const actor = c.get('user')!
  const id = int(c.req.param('id'))
  if (!id) return fail(c, 'validation', 'Некорректный id', 400)
  const body = await c.req.json().catch(() => ({}))

  const sets: string[] = []
  const params: unknown[] = []

  if (body.status !== undefined) {
    const status = str(body.status)
    if (!['active', 'disabled', 'locked'].includes(status)) {
      return fail(c, 'validation', 'Недопустимый статус', 400)
    }
    sets.push('status = ?')
    params.push(status)
    if (status === 'active') sets.push('failed_attempts = 0', 'locked_until = NULL')
  }
  if (body.role !== undefined) {
    const role = str(body.role) as RoleCode
    if (!ROLES.includes(role)) return fail(c, 'validation', 'Недопустимая роль', 400)
    const roleRow = await first<{ id: number }>(c.env.DB, `SELECT id FROM roles WHERE code = ?`, [role])
    sets.push('role_id = ?')
    params.push(roleRow?.id)
  }
  if (body.new_password !== undefined) {
    const pw = str(body.new_password)
    if (pw.length < 8) return fail(c, 'validation', 'Пароль не короче 8 символов', 400)
    await setPassword(c.env.DB, id, pw)
  }
  if (body.must_change_password !== undefined) {
    sets.push('must_change_password = ?')
    params.push(body.must_change_password ? 1 : 0)
  }

  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    await run(c.env.DB, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  if (body.revoke_sessions === true) {
    await revokeAllSessions(c.env.DB, id)
  }

  await audit(c.env.DB, {
    user_id: actor.id,
    username: actor.username,
    action: 'admin.users.update',
    entity_type: 'user',
    entity_id: id,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

// --- Roles + permission matrix ------------------------------------------
admin.get('/roles', requirePermission('admin.roles'), async (c) => {
  const roles = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name, description, priority FROM roles ORDER BY priority`
  )
  const perms = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT p.code, p.description, rp.role_id
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_id = p.id
      ORDER BY p.code`
  )
  const matrix: Record<number, string[]> = {}
  for (const row of perms) {
    const roleId = row.role_id as number | null
    if (roleId == null) continue
    ;(matrix[roleId] ??= []).push(row.code as string)
  }
  return ok(c, { roles, permissions: perms, matrix })
})

admin.get('/permissions', requirePermission('admin.roles'), async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, description FROM permissions ORDER BY code`
  )
  return ok(c, { items: rows })
})

// --- Audit log -----------------------------------------------------------
admin.get('/audit', requirePermission('admin.audit'), async (c) => {
  const { page, perPage, offset } = paginate(c)
  const action = str(c.req.query('action'))
  const userId = int(c.req.query('user_id'))
  const where: string[] = ['1=1']
  const params: unknown[] = []
  if (action) {
    where.push('action LIKE ?')
    params.push(`%${action}%`)
  }
  if (userId) {
    where.push('user_id = ?')
    params.push(userId)
  }
  const whereSql = where.join(' AND ')
  const total = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM audit_log WHERE ${whereSql}`,
    params
  )
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, user_id, username, action, entity_type, entity_id, details, ip, created_at
       FROM audit_log WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  )
  return ok(c, { items: rows, total: total?.n ?? 0, page, perPage })
})

// --- System settings -----------------------------------------------------
admin.get('/settings', requirePermission('admin.settings'), async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT key, value, updated_at FROM settings ORDER BY key`
  )
  return ok(c, { items: rows })
})

admin.put('/settings', requirePermission('admin.settings'), async (c) => {
  const actor = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const key = str(body.key)
  if (!key) return fail(c, 'validation', 'Укажите ключ', 400)
  const value = body.value == null ? '' : String(body.value)

  await run(
    c.env.DB,
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  )
  await audit(c.env.DB, {
    user_id: actor.id,
    username: actor.username,
    action: 'admin.settings.update',
    entity_type: 'setting',
    entity_id: key,
    ip: clientIp(c),
  })
  return ok(c, { updated: true })
})

// --- Seed a demo dataset (chief/admin convenience) -----------------------
admin.post('/seed', requirePermission('admin.settings'), async (c) => {
  const actor = c.get('user')!
  // Minimal guard: only seed when there are no patients yet.
  const existing = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM patients`)
  if ((existing?.n ?? 0) > 0) {
    return fail(c, 'conflict', 'Данные уже существуют', 409)
  }
  await audit(c.env.DB, {
    user_id: actor.id,
    username: actor.username,
    action: 'admin.seed.skip',
    details: 'seed via SQL file only',
    ip: clientIp(c),
  })
  return ok(c, { seeded: false, message: 'Используйте npm run db:seed для локальной БД' })
})

export default admin
