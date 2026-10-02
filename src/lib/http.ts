/**
 * http.ts — small HTTP helpers for the API routes.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../types'

export function ok<T>(c: Context<AppEnv>, data: T, status = 200) {
  return c.json({ success: true, data }, status as never)
}

export function fail(c: Context<AppEnv>, error: string, message: string, status = 400) {
  return c.json({ success: false, error, message }, status as never)
}

export function paginate(c: Context<AppEnv>) {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(c.req.query('per_page') ?? 20) || 20))
  return { page, perPage, offset: (page - 1) * perPage }
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
}

export function optStr(v: unknown): string | null {
  const s = str(v)
  return s === '' ? null : s
}

export function int(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** Parse a boolean-ish request body flag. */
export function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

/** Today's date (UTC) as YYYY-MM-DD. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function nowIso(): string {
  return new Date().toISOString()
}
