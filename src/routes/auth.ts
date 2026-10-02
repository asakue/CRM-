/**
 * auth routes — login / logout / register / me / change password.
 */

import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { AppEnv } from '../types'
import {
  login,
  createUser,
  revokeSession,
  setPassword,
  SESSION_COOKIE,
  CSRF_COOKIE,
  DEFAULT_SESSION_TTL_HOURS,
} from '../lib/auth'
import { first, run, audit } from '../lib/db'
import { verifyPassword, randomToken, sha256Hex } from '../lib/crypto'
import { ok, fail, str, optStr } from '../lib/http'
import { clientIp } from '../lib/middleware'
import { ROLE_LABELS } from '../lib/rbac'

const auth = new Hono<AppEnv>()

// --- Login ---------------------------------------------------------------
auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const username = str(body.username)
  const password = str(body.password)
  if (!username || !password) {
    return fail(c, 'validation', 'Введите логин и пароль', 400)
  }

  const ttl = Number(c.env.SESSION_TTL_HOURS ?? DEFAULT_SESSION_TTL_HOURS) || DEFAULT_SESSION_TTL_HOURS
  const ip = clientIp(c)

  const result = await login(c.env.DB, {
    username,
    password,
    ip,
    userAgent: c.req.header('User-Agent') ?? null,
    ttlHours: ttl,
  })

  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_credentials: 'Неверный логин или пароль',
      locked: 'Аккаунт временно заблокирован из-за неудачных попыток входа',
      disabled: 'Учётная запись отключена',
      rate_limited: 'Слишком много попыток. Попробуйте позже',
    }
    const status = result.error === 'rate_limited' ? 429 : 401
    return fail(c, result.error || 'error', messages[result.error || ''] || 'Ошибка входа', status)
  }

  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, result.token!, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: ttl * 3600,
  })
  setCookie(c, CSRF_COOKIE, result.csrfToken!, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: ttl * 3600,
  })

  return ok(c, {
    user: result.user,
    csrfToken: result.csrfToken,
    roleLabel: result.user ? ROLE_LABELS[result.user.role] : '',
  })
})

// --- Logout --------------------------------------------------------------
auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  const user = c.get('user')
  if (token) await revokeSession(c.env.DB, token)
  if (user) {
    await audit(c.env.DB, {
      user_id: user.id,
      username: user.username,
      action: 'auth.logout',
      ip: clientIp(c),
    })
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
  return ok(c, { loggedOut: true })
})

// --- Current user --------------------------------------------------------
auth.get('/me', (c) => {
  const user = c.get('user')
  if (!user) return fail(c, 'unauthorized', 'Не авторизован', 401)
  return ok(c, {
    user,
    csrfToken: c.get('csrfToken'),
    roleLabel: ROLE_LABELS[user.role],
  })
})

// --- Change own password -------------------------------------------------
auth.post('/change-password', async (c) => {
  const user = c.get('user')
  if (!user) return fail(c, 'unauthorized', 'Не авторизован', 401)

  const body = await c.req.json().catch(() => ({}))
  const current = str(body.current_password)
  const next = str(body.new_password)

  if (next.length < 8) {
    return fail(c, 'validation', 'Новый пароль должен быть не короче 8 символов', 400)
  }

  const row = await first<{ password_hash: string; password_salt: string; password_iterations: number }>(
    c.env.DB,
    `SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?`,
    [user.id]
  )
  if (!row) return fail(c, 'not_found', 'Пользователь не найден', 404)

  const valid = await verifyPassword(current, row.password_salt, row.password_hash, row.password_iterations)
  if (!valid) {
    await audit(c.env.DB, {
      user_id: user.id,
      username: user.username,
      action: 'auth.change_password_failed',
      ip: clientIp(c),
    })
    return fail(c, 'invalid_credentials', 'Текущий пароль неверен', 400)
  }

  await setPassword(c.env.DB, user.id, next)
  await audit(c.env.DB, {
    user_id: user.id,
    username: user.username,
    action: 'auth.change_password',
    ip: clientIp(c),
  })
  // Password change revoked all sessions — clear the cookie.
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
  return ok(c, { changed: true })
})

// --- Register (self-service, always creates a patient role) --------------
auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const username = str(body.username)
  const password = str(body.password)
  const fullName = str(body.full_name)
  const email = optStr(body.email)

  if (username.length < 3) return fail(c, 'validation', 'Логин не короче 3 символов', 400)
  if (password.length < 8) return fail(c, 'validation', 'Пароль не короче 8 символов', 400)
  if (!fullName) return fail(c, 'validation', 'Укажите ФИО', 400)

  // Registration is intentionally closed unless enabled by an administrator.
  const enabled = await first<{ value: string }>(
    c.env.DB,
    `SELECT value FROM settings WHERE key = 'registration_open'`
  )
  if ((enabled?.value ?? 'false') !== 'true') {
    return fail(c, 'forbidden', 'Регистрация закрыта. Обратитесь в регистратуру', 403)
  }

  const exists = await first<{ id: number }>(c.env.DB, `SELECT id FROM users WHERE username = ?`, [username])
  if (exists) return fail(c, 'conflict', 'Такой логин уже занят', 409)

  const userId = await createUser(c.env.DB, {
    username,
    password,
    roleCode: 'patient',
    full_name: fullName,
    email: email ?? undefined,
  })

  // Create the linked patient chart.
  const { createPatient, assignPatientNo } = await import('../lib/patient-service')
  const patientId = await createPatient(
    c.env.DB,
    c.env.APP_SECRET,
    { full_name: fullName, email, user_id: userId },
    userId
  )
  await assignPatientNo(c.env.DB, patientId)

  await audit(c.env.DB, {
    user_id: userId,
    username,
    action: 'auth.register',
    entity_type: 'patient',
    entity_id: patientId,
    ip: clientIp(c),
  })

  return ok(c, { userId, patientId }, 201)
})

// --- Session heartbeat / CSRF refresh ------------------------------------
auth.get('/csrf', (c) => {
  const user = c.get('user')
  if (!user) return fail(c, 'unauthorized', 'Не авторизован', 401)
  return ok(c, { csrfToken: c.get('csrfToken') })
})

export default auth
