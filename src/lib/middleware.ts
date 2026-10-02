/**
 * middleware.ts — request pipeline: security headers, session loading,
 * CSRF protection and helpers.
 */

import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../types'
import { loadSession, buildSessionUser, SESSION_COOKIE } from './auth'

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; " +
  "img-src 'self' data: blob:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'"

export async function securityHeaders(c: Context<AppEnv>, next: Next) {
  await next()
  const h = c.res.headers
  h.set('Content-Security-Policy', CSP)
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('X-Frame-Options', 'DENY')
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Cross-Origin-Resource-Policy', 'same-origin')
  // Never cache authenticated HTML/JSON.
  if (!c.res.headers.get('Cache-Control')) {
    h.set('Cache-Control', 'no-store')
  }
}

// ---------------------------------------------------------------------------
// Session loading
// ---------------------------------------------------------------------------

export async function loadUser(c: Context<AppEnv>, next: Next) {
  c.set('user', null)
  c.set('csrfToken', '')
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const record = await loadSession(c.env.DB, token)
    if (record) {
      const user = await buildSessionUser(c.env.DB, record)
      // Attach full name from DB row (buildSessionUser leaves it null otherwise).
      user.full_name = record.full_name
      c.set('user', user)
      c.set('csrfToken', record.csrf_token)
      c.set('sessionId', record.session_id)
    }
  }
  await next()
}

// ---------------------------------------------------------------------------
// CSRF (double-submit: cookie value must equal X-CSRF-Token header)
// ---------------------------------------------------------------------------

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function csrfProtection(c: Context<AppEnv>, next: Next) {
  if (!MUTATING.has(c.req.method)) return next()
  // Allow unauthenticated auth endpoints (login/register) — they carry no session.
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register')) {
    return next()
  }
  const user = c.get('user')
  if (!user) return next() // requireAuth will reject with 401

  const header = c.req.header('X-CSRF-Token') || ''
  const sessionToken = c.get('csrfToken')
  if (!header || !sessionToken || header !== sessionToken) {
    return c.json({ error: 'csrf', message: 'Ошибка проверки CSRF-токена' }, 403)
  }
  await next()
}

// ---------------------------------------------------------------------------
// Layout data helper (used by the JSX renderer)
// ---------------------------------------------------------------------------

export function clientIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null
  )
}
