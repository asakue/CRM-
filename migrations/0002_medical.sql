-- =============================================================================
-- Hospital CRM — Migration 0002: Medical domain
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  head_user_id  INTEGER,                      -- user with role 'head'
  location      TEXT,
  phone         TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (head_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_departments_head ON departments(head_user_id);

-- ---------------------------------------------------------------------------
-- Patients
-- Encrypted fields marked (enc) are AES-GCM ciphertext blobs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no        TEXT UNIQUE NOT NULL,     -- public chart number, e.g. P-000123
  user_id           INTEGER,                  -- login account (role patient), nullable
  full_name         TEXT NOT NULL,            -- (enc)
  full_name_hash    TEXT,                     -- blind index for search
  birth_date        TEXT,                     -- (enc) ISO date
  birth_year        INTEGER,                  -- non-sensitive, for statistics
  gender            TEXT,                     -- male | female | other
  phone             TEXT,                     -- (enc)
  email             TEXT,                     -- (enc)
  address           TEXT,                     -- (enc)
  blood_type        TEXT,
  allergies         TEXT,                     -- (enc)
  chronic_conditions TEXT,                    -- (enc)
  insurance_no      TEXT,                     -- (enc)
  snils             TEXT,                     -- (enc)
  notes             TEXT,                     -- (enc)
  status            TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_by        INTEGER,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_patients_user ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_name_hash ON patients(full_name_hash);
CREATE INDEX IF NOT EXISTS idx_patients_birth_year ON patients(birth_year);

-- ---------------------------------------------------------------------------
-- Doctors (user with role doctor/head/chief + professional profile)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  department_id  INTEGER,
  specialty      TEXT,
  category       TEXT,                        -- высшая | первая | вторая | none
  room           TEXT,
  cabinet_phone  TEXT,
  bio            TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_doctors_user ON doctors(user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_department ON doctors(department_id);

-- ---------------------------------------------------------------------------
-- Appointments (записи на приём)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL,
  doctor_id      INTEGER NOT NULL,
  department_id  INTEGER,
  scheduled_at   DATETIME NOT NULL,          -- ISO 8601
  duration_min   INTEGER NOT NULL DEFAULT 30,
  type           TEXT NOT NULL DEFAULT 'consultation', -- consultation | followup | procedure | analysis
  status         TEXT NOT NULL DEFAULT 'scheduled',
                 -- scheduled | confirmed | completed | cancelled | no_show
  reason         TEXT,                        -- (enc)
  created_by     INTEGER,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id)    REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id)     REFERENCES doctors(id)  ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)    REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);

-- ---------------------------------------------------------------------------
-- Medical records (записи приёма: жалобы, диагноз, назначения)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medical_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  doctor_id       INTEGER NOT NULL,
  appointment_id  INTEGER,
  visit_date      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  complaints      TEXT,                        -- (enc)
  diagnosis       TEXT,                        -- (enc) ICD text
  icd_code        TEXT,                        -- non-sensitive code for stats
  treatment       TEXT,                        -- (enc)
  recommendation  TEXT,                        -- (enc)
  vitals          TEXT,                        -- (enc) JSON: BP, temp, pulse...
  created_by      INTEGER,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id)     REFERENCES patients(id)    ON DELETE CASCADE,
  FOREIGN KEY (doctor_id)      REFERENCES doctors(id)     ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)     REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_records_doctor ON medical_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_records_icd ON medical_records(icd_code);

-- ---------------------------------------------------------------------------
-- Analyses catalog (справочник анализов)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,                          -- blood | urine | imaging | other
  unit          TEXT,
  ref_min       REAL,
  ref_max       REAL,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Analysis orders (направления)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analyses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL,
  doctor_id     INTEGER NOT NULL,
  type_id       INTEGER NOT NULL,
  ordered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performed_at  DATETIME,
  status        TEXT NOT NULL DEFAULT 'ordered',
                -- ordered | in_progress | completed | cancelled
  created_by    INTEGER,
  FOREIGN KEY (patient_id) REFERENCES patients(id)      ON DELETE CASCADE,
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)       ON DELETE CASCADE,
  FOREIGN KEY (type_id)    REFERENCES analysis_types(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_analyses_patient ON analyses(patient_id, ordered_at);
CREATE INDEX IF NOT EXISTS idx_analyses_doctor ON analyses(doctor_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);

-- ---------------------------------------------------------------------------
-- Analysis results (результаты; value — enc where textual)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id   INTEGER NOT NULL,
  value_numeric REAL,
  value_text    TEXT,                          -- (enc)
  flag          TEXT,                          -- normal | low | high | abnormal
  comment       TEXT,                          -- (enc)
  entered_by    INTEGER,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
  FOREIGN KEY (entered_by)  REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_results_analysis ON analysis_results(analysis_id);

-- ---------------------------------------------------------------------------
-- Prescriptions (назначения/рецепты)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL,
  doctor_id      INTEGER NOT NULL,
  record_id      INTEGER,
  medication     TEXT,                         -- (enc)
  dosage         TEXT,                         -- (enc)
  instructions   TEXT,                         -- (enc)
  issued_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     DATETIME,
  status         TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  FOREIGN KEY (patient_id) REFERENCES patients(id)         ON DELETE CASCADE,
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)          ON DELETE CASCADE,
  FOREIGN KEY (record_id)  REFERENCES medical_records(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor ON prescriptions(doctor_id);
