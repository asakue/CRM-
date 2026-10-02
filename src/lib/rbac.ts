/**
 * rbac.ts — role checks and route guards.
 */

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import type { RoleCode, SessionUser } from '../types'

export const ROLE_LABELS: Record<RoleCode, string> = {
  patient: 'Пациент',
  doctor: 'Врач',
  head: 'Зав. отделением',
  chief: 'Главный врач',
  admin: 'Администратор',
}

export function hasPermission(user: SessionUser | null, code: string | string[]): boolean {
  if (!user) return false
  const needed = Array.isArray(code) ? code : [code]
  // any-of semantics
  return needed.some((c) => user.permissions.includes(c))
}

export function hasRole(user: SessionUser | null, roles: RoleCode | RoleCode[]): boolean {
  if (!user) return false
  const list = Array.isArray(roles) ? roles : [roles]
  return list.includes(user.role)
}

/** Can this user read data belonging to `deptId`? */
export function canAccessDepartment(
  user: SessionUser | null,
  deptId: number | null | undefined
): boolean {
  if (!user) return false
  if (hasPermission(user, ['patients.view.all', 'appointments.view.all', 'records.view.all'])) {
    return true
  }
  if (deptId == null) return false
  return user.department_id === deptId
}

// ---------------------------------------------------------------------------
// Hono middleware guards
//
// Global authentication is enforced in index.tsx for all /api/* routes; the
// guards below add role- and permission-level checks on top of it.
// ---------------------------------------------------------------------------

/** Require one of the given roles. */
export function requireRole(...roles: RoleCode[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (!hasRole(user, roles)) {
      return c.json({ error: 'forbidden', message: 'Недостаточно прав' }, 403)
    }
    await next()
  }
}

/** Require a permission (any-of). */
export function requirePermission(...codes: string[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (!hasPermission(user, codes)) {
      return c.json({ error: 'forbidden', message: 'Недостаточно прав' }, 403)
    }
    await next()
  }
}
