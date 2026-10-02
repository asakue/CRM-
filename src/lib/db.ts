/**
 * db.ts — thin helpers over D1 with a single choke-point for audit logging.
 */

import type { D1Database, D1Result } from '@cloudflare/workers-types'

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const stmt = db.prepare(sql)
  const bound = params.length ? stmt.bind(...params) : stmt
  const res = await bound.all<T>()
  return res.results ?? []
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const stmt = db.prepare(sql)
  const bound = params.length ? stmt.bind(...params) : stmt
  return (await bound.first<T>()) ?? null
}

export async function run(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<D1Result> {
  const stmt = db.prepare(sql)
  const bound = params.length ? stmt.bind(...params) : stmt
  return bound.run()
}

export async function insert(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<number> {
  const res = await run(db, sql, params)
  return Number(res.meta?.last_row_id ?? 0)
}

export interface AuditInput {
  user_id?: number | null
  username?: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | number | null
  details?: string | null
  ip?: string | null
}

/** Append an immutable audit entry. Never throws (audit must not break flow). */
export async function audit(db: D1Database, a: AuditInput): Promise<void> {
  try {
    await run(
      db,
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        a.user_id ?? null,
        a.username ?? null,
        a.action,
        a.entity_type ?? null,
        a.entity_id != null ? String(a.entity_id) : null,
        a.details ?? null,
        a.ip ?? null,
      ]
    )
  } catch (err) {
    console.error('audit error', err)
  }
}
