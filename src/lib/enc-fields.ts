/**
 * enc-fields.ts — generic helpers to encrypt / decrypt a named set of columns.
 *
 * Used by medical records, analysis results and prescriptions, where several
 * free-text columns are sensitive.
 */

import { encryptField, decryptField } from './crypto'

/** Encrypt the given fields of a body object into a column->ciphertext map. */
export async function encFields(
  secret: string,
  body: Record<string, unknown>,
  fields: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = body[f]
    out[f] = await encryptField(v == null ? '' : String(v), secret)
  }
  return out
}

/** Decrypt the given fields of a DB row in place (returns a plain object). */
export async function decFields(
  secret: string,
  row: Record<string, unknown>,
  fields: string[]
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...row }
  for (const f of fields) {
    out[f] = await decryptField(row[f] as string, secret)
  }
  return out
}

/** Decrypt the given fields for every row in a list. */
export async function decFieldsAll(
  secret: string,
  rows: Record<string, unknown>[],
  fields: string[]
): Promise<Record<string, unknown>[]> {
  return Promise.all(rows.map((r) => decFields(secret, r, fields)))
}
