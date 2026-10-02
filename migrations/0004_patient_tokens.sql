-- =============================================================================
-- Hospital CRM — Migration 0004: searchable name tokens (blind index)
--
-- Full-text search over encrypted names is impossible directly. We store a
-- space-separated list of HMAC-SHA256 hashes — one per name token — so a query
-- like "иванов сергей" matches "Иванов Сергей Николаевич" without decrypting.
-- =============================================================================

ALTER TABLE patients ADD COLUMN name_tokens TEXT;
CREATE INDEX IF NOT EXISTS idx_patients_name_tokens ON patients(name_tokens);
