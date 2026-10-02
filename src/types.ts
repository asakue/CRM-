import type { D1Database } from '@cloudflare/workers-types'

/** Environment bindings available to the Worker. */
export type Bindings = {
  DB: D1Database
  /** Secret used for field encryption + blind indexes (AES key derivation). */
  APP_SECRET: string
  /** Session lifetime in hours (optional, default 12). */
  SESSION_TTL_HOURS?: string
  APP_NAME?: string
  PBKDF2_ITERATIONS?: string
}

export type RoleCode = 'patient' | 'doctor' | 'head' | 'chief' | 'admin'

export interface SessionUser {
  id: number
  username: string
  full_name: string | null
  role: RoleCode
  role_id: number
  department_id?: number | null
  doctor_id?: number | null
  patient_id?: number | null
  permissions: string[]
}

export interface AppVariables {
  user: SessionUser | null
  csrfToken: string
  sessionId: number
}

export type AppEnv = {
  Bindings: Bindings
  Variables: AppVariables
}
