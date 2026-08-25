-- Up Migration
-- VibeMatch — Blueprint V1.2 §2.1
-- gen_random_uuid() is built-in from PostgreSQL 13+. pgcrypto kept for digest() fallback.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Down Migration
-- Intentionally NOT dropping pgcrypto: other objects may depend on it.
