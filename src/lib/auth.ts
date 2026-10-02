/**
 * auth.ts — authentication, sessions and lockout.
 *
 * Passwords : PBKDF2-HMAC-SHA256 (max 100k iterations in workerd).
 * Sessions  : opaque 32-byte token in an HttpOnly cookie; only its SHA-256
 *             hex digest is persisted. Rotation on every login.
 * Lockout   : after N failed attempts the account is locked for a window.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  hashPassword,
  verifyPassword,
  sha256Hex,
  randomToken,
  PBKDF2_ITERATIONS,
} from './crypto'
import { all, first, insert, run, audit } from './db'
import type { RoleCode, SessionUser } from '../types'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15
export const SESSION_COOKIE = 'hosp_session'
export const CSRF_COOKIE = 'hosp_csrf'
export const DEFAULT_SESSION_TTL_HOURS = 12

export interface SessionRecord {
  session_id: number
  user_id: number
  username: string
  full_name: string | null
  role: RoleCode
  role_id: number
  status: string
  csrf_token: string
  expires_at: string
  department_id: number | null
  doctor_id: number | null
  patient_id: number | null
}

/** Load the effective permission codes for a role. */
export async function permissionsForRole(
  db: D1Database,
  roleId: number
): Promise<string[]> {
  const rows = await all<{ code: string }>(
    db,
    `SELECT p.code AS code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?`,
    [roleId]
  )
  return rows.map((r) => r.code)
}

/** Resolve the doctor/patient profile attached to a user, if any. */
async function resolveProfileIds(
  db: D1Database,
  userId: number
): Promise<{ doctor_id: number | null; patient_id: number | null; department_id: number | null }> {
  const doc = await first<{ id: number; department_id: number | null }>(
    db,
    `SELECT id, department_id FROM doctors WHERE user_id = ? LIMIT 1`,
    [userId]
  )
  const pat = await first<{ id: number }>(
    db,
    `SELECT id FROM patients WHERE user_id = ? LIMIT 1`,
    [userId]
  )
  return {
    doctor_id: doc?.id ?? null,
    patient_id: pat?.id ?? null,
    department_id: doc?.department_id ?? null,
  }
}

export async function buildSessionUser(
  db: D1Database,
  row: SessionRecord
): Promise<SessionUser> {
  const perms = await permissionsForRole(db, row.role_id)
  return {
    id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    role_id: row.role_id,
    permissions: perms,
    doctor_id: row.doctor_id,
    patient_id: row.patient_id,
    department_id: row.department_id,
  }
}

export interface LoginResult {
  ok: boolean
  error?: 'invalid_credentials' | 'locked' | 'disabled' | 'rate_limited'
  retryAfterMinutes?: number
  token?: string
  csrfToken?: string
  ttlHours?: number
  user?: SessionUser
}

/** Create a brand-new user with a hashed password. */
export async function createUser(
  db: D1Database,
  input: {
    username: string
    password: string
    roleCode: RoleCode
    full_name?: string
    email?: string
    mustChangePassword?: boolean
  }
): Promise<number> {
  const role = await first<{ id: number }>(db, `SELECT id FROM roles WHERE code = ?`, [
    input.roleCode,
  ])
  if (!role) throw new Error(`role not found: ${input.roleCode}`)
  const { hash, salt, iterations } = await hashPassword(input.password, PBKDF2_ITERATIONS)
  return insert(
    db,
    `INSERT INTO users (username, email, full_name, password_hash, password_salt,
                        password_iterations, role_id, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.username,
      input.email ?? null,
      input.full_name ?? null,
      hash,
      salt,
      iterations,
      role.id,
      input.mustChangePassword ? 1 : 0,
    ]
  )
}

export async function setPassword(
  db: D1Database,
  userId: number,
  password: string
): Promise<void> {
  const { hash, salt, iterations } = await hashPassword(password, PBKDF2_ITERATIONS)
  await run(
    db,
    `UPDATE users
        SET password_hash = ?, password_salt = ?, password_iterations = ?,
            must_change_password = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [hash, salt, iterations, userId]
  )
  // Revoke all existing sessions on password change.
  await run(db, `UPDATE sessions SET revoked = 1 WHERE user_id = ?`, [userId])
}

/** Attempt a login. Applies rate limiting + account lockout. */
export async function login(
  db: D1Database,
  opts: {
    username: string
    password: string
    ip: string | null
    userAgent: string | null
    ttlHours: number
    windowMinutes?: number
  }
): Promise<LoginResult> {
  const windowMinutes = opts.windowMinutes ?? 15

  // --- IP rate limit (defence against distributed guessing) --------------
  if (opts.ip) {
    const ipAttempts = await first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE ip = ? AND success = 0 AND created_at >= datetime('now', ?)`,
      [opts.ip, `-${windowMinutes} minutes`]
    )
    if ((ipAttempts?.n ?? 0) >= 30) {
      return { ok: false, error: 'rate_limited', retryAfterMinutes: windowMinutes }
    }
  }

  const user = await first<{
    id: number
    username: string
    password_hash: string
    password_salt: string
    password_iterations: number
    role_id: number
    status: string
    failed_attempts: number
    locked_until: string | null
  }>(
    db,
    `SELECT id, username, password_hash, password_salt, password_iterations,
            role_id, status, failed_attempts, locked_until
       FROM users WHERE username = ?`,
    [opts.username]
  )

  const record = async (success: boolean) => {
    await run(
      db,
      `INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)`,
      [opts.username, opts.ip, success ? 1 : 0]
    )
  }

  if (!user) {
    await record(false)
    return { ok: false, error: 'invalid_credentials' }
  }

  if (user.status === 'disabled') {
    await record(false)
    return { ok: false, error: 'disabled' }
  }

  if (user.locked_until) {
    const locked = await first<{ locked: number }>(
      db,
      `SELECT (locked_until > datetime('now')) AS locked FROM users WHERE id = ?`,
      [user.id]
    )
    if (locked?.locked) {
      await record(false)
      return { ok: false, error: 'locked', retryAfterMinutes: LOCKOUT_MINUTES }
    }
  }

  const valid = await verifyPassword(
    opts.password,
    user.password_salt,
    user.password_hash,
    user.password_iterations
  )

  if (!valid) {
    const attempts = (user.failed_attempts ?? 0) + 1
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await run(
        db,
        `UPDATE users SET failed_attempts = ?,
              locked_until = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [attempts, `+${LOCKOUT_MINUTES} minutes`, user.id]
      )
      await record(false)
      await audit(db, {
        user_id: user.id,
        username: user.username,
        action: 'auth.lockout',
        details: `locked after ${attempts} failed attempts`,
        ip: opts.ip,
      })
      return { ok: false, error: 'locked', retryAfterMinutes: LOCKOUT_MINUTES }
    }
    await run(
      db,
      `UPDATE users SET failed_attempts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [attempts, user.id]
    )
    await record(false)
    return { ok: false, error: 'invalid_credentials' }
  }

  // --- success -----------------------------------------------------------
  await record(true)
  await run(
    db,
    `UPDATE users
        SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [user.id]
  )

  const token = randomToken(32)
  const csrfToken = randomToken(24)
  const tokenHash = await sha256Hex(token)

  await insert(
    db,
    `INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
    [tokenHash, user.id, csrfToken, opts.ip, opts.userAgent, `+${opts.ttlHours} hours`]
  )

  const profile = await resolveProfileIds(db, user.id)
  const role = await first<{ code: RoleCode }>(db, `SELECT code FROM roles WHERE id = ?`, [
    user.role_id,
  ])
  const perms = await permissionsForRole(db, user.role_id)

  await audit(db, {
    user_id: user.id,
    username: user.username,
    action: 'auth.login',
    ip: opts.ip,
  })

  return {
    ok: true,
    token,
    csrfToken,
    ttlHours: opts.ttlHours,
    user: {
      id: user.id,
      username: user.username,
      full_name: null,
      role: (role?.code ?? 'patient') as RoleCode,
      role_id: user.role_id,
      permissions: perms,
      ...profile,
    },
  }
}

/** Validate a session token and return the joined session row (or null). */
export async function loadSession(
  db: D1Database,
  token: string
): Promise<SessionRecord | null> {
  const tokenHash = await sha256Hex(token)
  const row = await first<SessionRecord>(
    db,
    `SELECT s.id AS session_id, s.user_id, u.username, u.full_name, u.status,
            r.code AS role, r.id AS role_id, s.csrf_token, s.expires_at,
            d.id AS doctor_id, d.department_id AS department_id, p.id AS patient_id
       FROM sessions s
       JOIN users u      ON u.id = s.user_id
       JOIN roles r      ON r.id = u.role_id
       LEFT JOIN doctors  d ON d.user_id = u.id
       LEFT JOIN patients p ON p.user_id = u.id
      WHERE s.token_hash = ?
        AND s.revoked = 0
        AND s.expires_at > datetime('now')
        AND u.status = 'active'
      LIMIT 1`,
    [tokenHash]
  )
  if (!row) return null
  // Touch last_seen (best-effort).
  try {
    await run(db, `UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      row.session_id,
    ])
  } catch {
    /* non-fatal */
  }
  return row
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token)
  await run(db, `UPDATE sessions SET revoked = 1 WHERE token_hash = ?`, [tokenHash])
}

export async function revokeAllSessions(db: D1Database, userId: number): Promise<void> {
  await run(db, `UPDATE sessions SET revoked = 1 WHERE user_id = ?`, [userId])
}
