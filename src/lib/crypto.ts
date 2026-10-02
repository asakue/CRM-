/**
 * crypto.ts — Cryptographic primitives for Hospital CRM
 *
 * Design notes (Cloudflare Workers runtime — Web Crypto only, no Node APIs):
 *  - Password hashing : PBKDF2-HMAC-SHA256. workerd caps PBKDF2 at 100_000
 *    iterations, so that is our maximum and default.
 *  - Field encryption : AES-256-GCM. One 256-bit data key derived from the
 *    APP_SECRET via HKDF-SHA256. A fresh random 96-bit IV per encryption.
 *    Ciphertext layout: base64( iv(12) || ciphertext||tag ).
 *  - Blind index      : deterministic HMAC-SHA256 over a normalized value,
 *    used to search encrypted columns (e.g. patient full name) without
 *    decrypting rows.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Base64 helpers (Workers has atob/btoa but not Buffer)
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function randomToken(n = 32): string {
  return bytesToBase64(randomBytes(n)).replace(/[+/=]/g, '')
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-HMAC-SHA256)
// ---------------------------------------------------------------------------

/**
 * Iteration count. workerd hard-caps PBKDF2 at 100_000. On the Workers *free*
 * plan the CPU budget is 10 ms/request, and 100k iterations can exceed it —
 * which would make every login fail. 25_000 keeps logins comfortably inside
 * the free budget while remaining a real KDF work factor. Raise it via the
 * PBKDF2_ITERATIONS var on a paid plan.
 */
export const PBKDF2_ITERATIONS = 25_000
export const PBKDF2_MAX_ITERATIONS = 100_000
const PBKDF2_KEYLEN = 32 // bytes -> 256 bit

async function derivePasswordBits(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEYLEN * 8
  )
}

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = randomBytes(16)
  const bits = await derivePasswordBits(password, salt, iterations)
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
    iterations,
  }
}

/** Constant-time-ish comparison of two base64 strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  iterations = PBKDF2_ITERATIONS
): Promise<boolean> {
  const bits = await derivePasswordBits(password, base64ToBytes(salt), iterations)
  return timingSafeEqual(bytesToBase64(new Uint8Array(bits)), expectedHash)
}

// ---------------------------------------------------------------------------
// Key derivation (APP_SECRET -> AES-256 data key)
// ---------------------------------------------------------------------------

const keyCache = new Map<string, CryptoKey>()

/**
 * Derive a stable AES-256-GCM key from the application secret.
 * Never hardcode a production secret; APP_SECRET must come from a
 * Cloudflare secret binding. A dev fallback keeps local preview working.
 */
export async function getDataKey(appSecret: string): Promise<CryptoKey> {
  const cached = keyCache.get(appSecret)
  if (cached) return cached

  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(appSecret),
    'HKDF',
    false,
    ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('hospital-crm-field-encryption-v1'),
      info: enc.encode('aes-256-gcm-data-key'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  keyCache.set(appSecret, key)
  return key
}

// ---------------------------------------------------------------------------
// Field-level encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

/** Encrypt a string. Returns base64(iv||ciphertext). Empty/null -> ''. */
export async function encryptField(
  plaintext: string | null | undefined,
  appSecret: string
): Promise<string> {
  if (plaintext === null || plaintext === undefined || plaintext === '') return ''
  const key = await getDataKey(appSecret)
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  )
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return bytesToBase64(out)
}

/**
 * Decrypt base64(iv||ciphertext). Returns '' on empty.
 *
 * Tolerance rules (for demo/legacy data only):
 *  - a value prefixed with `plain:` is returned verbatim;
 *  - a value that is not valid base64 (e.g. a raw ISO date) is returned as-is
 *    rather than throwing, so one legacy column can't 500 a whole list;
 *  - a tampered/corrupt ciphertext (valid base64 but AES-GCM auth fails)
 *    returns '' so corrupted data is hidden instead of shown as garbage.
 */
export async function decryptField(
  ciphertext: string | null | undefined,
  appSecret: string
): Promise<string> {
  if (!ciphertext) return ''
  if (typeof ciphertext === 'string' && ciphertext.startsWith('plain:')) {
    return ciphertext.slice('plain:'.length)
  }
  if (!isLikelyBase64(ciphertext)) return ciphertext
  try {
    const key = await getDataKey(appSecret)
    const raw = base64ToBytes(ciphertext)
    if (raw.length <= 12) return '' // too short to hold iv + tag
    const iv = raw.slice(0, 12)
    const body = raw.slice(12)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body)
    return dec.decode(pt)
  } catch {
    // Valid base64 but not decryptable (wrong key or tampered) — hide it.
    return ''
  }
}

/** Heuristic: does the string consist only of base64 alphabet chars? */
function isLikelyBase64(s: string): boolean {
  if (s.length < 16 || s.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s)
}

// ---------------------------------------------------------------------------
// Blind index (deterministic searchable hash over encrypted values)
// ---------------------------------------------------------------------------

export async function blindIndex(value: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ')
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(normalized))
  return bytesToBase64(new Uint8Array(sig))
}

// ---------------------------------------------------------------------------
// Session / generic hashing
// ---------------------------------------------------------------------------

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
