/**
 * patient-service.ts — encrypt/decrypt the sensitive patient columns.
 *
 * Sensitive columns are stored as AES-GCM ciphertext (see crypto.ts).
 * `patients.full_name_hash` is a deterministic blind index so name search
 * works without decrypting every row.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { encryptField, decryptField, blindIndex } from './crypto'
import { insert, run, all } from './db'

export interface PatientInput {
  full_name: string
  birth_date?: string | null
  gender?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  blood_type?: string | null
  allergies?: string | null
  chronic_conditions?: string | null
  insurance_no?: string | null
  snils?: string | null
  notes?: string | null
  status?: string
  user_id?: number | null
}

/** Human-facing plaintext shape returned to the API/UI. */
export interface PatientView {
  id: number
  patient_no: string
  user_id: number | null
  full_name: string
  birth_date: string
  gender: string
  phone: string
  email: string
  address: string
  blood_type: string
  allergies: string
  chronic_conditions: string
  insurance_no: string
  snils: string
  notes: string
  status: string
  created_at: string
  updated_at: string
  age?: number | null
}

function ageFrom(birth: string): number | null {
  if (!birth) return null
  const d = new Date(birth)
  if (isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
}

/** Normalize and split a full name into searchable tokens. */
function nameTokens(fullName: string): string[] {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[\s,.-]+/)
    .filter((t) => t.length >= 2)
}

/**
 * Build the token blind-index string: one HMAC per name token, space joined.
 * A query token matches a stored token by exact HMAC equality, so multi-word
 * search ("иванов сергей") works without decrypting.
 */
export async function buildNameTokens(fullName: string, secret: string): Promise<string> {
  const tokens = nameTokens(fullName)
  const hashes = await Promise.all(tokens.map((t) => blindIndex(t, secret)))
  return hashes.join(' ')
}

/** Turn a search query into the list of token hashes to match against. */
export async function queryTokenHashes(query: string, secret: string): Promise<string[]> {
  const tokens = nameTokens(query)
  return Promise.all(tokens.map((t) => blindIndex(t, secret)))
}

export async function createPatient(
  db: D1Database,
  secret: string,
  input: PatientInput,
  createdBy: number | null
): Promise<number> {
  const nameHash = await blindIndex(input.full_name, secret)
  const tokens = await buildNameTokens(input.full_name, secret)
  return insert(
    db,
    `INSERT INTO patients
       (patient_no, user_id, full_name, full_name_hash, name_tokens, birth_date, gender, phone, email,
        address, blood_type, allergies, chronic_conditions, insurance_no, snils, notes,
        status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      '', // assigned after insert
      input.user_id ?? null,
      await encryptField(input.full_name, secret),
      nameHash,
      tokens,
      await encryptField(input.birth_date ?? '', secret),
      input.gender ?? null,
      await encryptField(input.phone ?? '', secret),
      await encryptField(input.email ?? '', secret),
      await encryptField(input.address ?? '', secret),
      input.blood_type ?? null,
      await encryptField(input.allergies ?? '', secret),
      await encryptField(input.chronic_conditions ?? '', secret),
      await encryptField(input.insurance_no ?? '', secret),
      await encryptField(input.snils ?? '', secret),
      await encryptField(input.notes ?? '', secret),
      input.status ?? 'active',
      createdBy,
    ]
  )
}

/** Assign the human chart number P-000123 after the row gets its id. */
export async function assignPatientNo(db: D1Database, id: number): Promise<string> {
  const no = `P-${String(id).padStart(6, '0')}`
  await run(db, `UPDATE patients SET patient_no = ? WHERE id = ?`, [no, id])
  return no
}

export async function updatePatient(
  db: D1Database,
  secret: string,
  id: number,
  input: Partial<PatientInput>
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []

  const enc = async (col: string, value: string | null | undefined) => {
    if (value === undefined) return
    sets.push(`${col} = ?`)
    params.push(await encryptField(value ?? '', secret))
  }

  if (input.full_name !== undefined) {
    sets.push('full_name = ?', 'full_name_hash = ?', 'name_tokens = ?')
    params.push(
      await encryptField(input.full_name, secret),
      await blindIndex(input.full_name, secret),
      await buildNameTokens(input.full_name, secret)
    )
  }
  await enc('birth_date', input.birth_date)
  await enc('phone', input.phone)
  await enc('email', input.email)
  await enc('address', input.address)
  await enc('allergies', input.allergies)
  await enc('chronic_conditions', input.chronic_conditions)
  await enc('insurance_no', input.insurance_no)
  await enc('snils', input.snils)
  await enc('notes', input.notes)

  for (const plain of ['gender', 'blood_type', 'status'] as const) {
    if (input[plain] !== undefined) {
      sets.push(`${plain} = ?`)
      params.push(input[plain])
    }
  }

  if (!sets.length) return
  sets.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)
  await run(db, `UPDATE patients SET ${sets.join(', ')} WHERE id = ?`, params)
}

/**
 * Lazily fill name_tokens for rows written before migration 0004.
 * Runs at most over the unindexed rows; safe to call on every search.
 */
export async function backfillNameTokens(db: D1Database, secret: string): Promise<number> {
  const rows = await all<{ id: number; full_name: string }>(
    db,
    `SELECT id, full_name FROM patients
      WHERE name_tokens IS NULL OR name_tokens = ''
      LIMIT 200`
  )
  for (const row of rows) {
    const plain = await decryptField(row.full_name, secret)
    if (!plain) continue
    const tokens = await buildNameTokens(plain, secret)
    const hash = await blindIndex(plain, secret)
    await run(
      db,
      `UPDATE patients SET name_tokens = ?, full_name_hash = COALESCE(NULLIF(full_name_hash,''), ?) WHERE id = ?`,
      [tokens, hash, row.id]
    )
  }
  return rows.length
}

/** Decrypt a raw patient row into the plaintext view. */
export async function decryptPatient(
  row: Record<string, unknown>,
  secret: string
): Promise<PatientView> {
  const birth = await decryptField(row.birth_date as string, secret)
  return {
    id: row.id as number,
    patient_no: (row.patient_no as string) ?? '',
    user_id: (row.user_id as number) ?? null,
    full_name: await decryptField(row.full_name as string, secret),
    birth_date: birth,
    gender: (row.gender as string) ?? '',
    phone: await decryptField(row.phone as string, secret),
    email: await decryptField(row.email as string, secret),
    address: await decryptField(row.address as string, secret),
    blood_type: (row.blood_type as string) ?? '',
    allergies: await decryptField(row.allergies as string, secret),
    chronic_conditions: await decryptField(row.chronic_conditions as string, secret),
    insurance_no: await decryptField(row.insurance_no as string, secret),
    snils: await decryptField(row.snils as string, secret),
    notes: await decryptField(row.notes as string, secret),
    status: (row.status as string) ?? 'active',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    age: ageFrom(birth),
  }
}

/** Decrypt a list of patient rows. */
export async function decryptPatients(
  rows: Record<string, unknown>[],
  secret: string
): Promise<PatientView[]> {
  return Promise.all(rows.map((r) => decryptPatient(r, secret)))
}
