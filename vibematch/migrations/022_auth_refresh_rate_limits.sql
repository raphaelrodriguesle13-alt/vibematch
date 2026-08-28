-- Up Migration
-- Distributed fixed-window rate limits for unauthenticated refresh endpoints.
-- Never stores refresh tokens or client IPs; only SHA-256 credential fingerprints.

CREATE TABLE auth_rate_limits (
  scope             TEXT NOT NULL CHECK (scope IN ('REFRESH','LOGOUT_REFRESH')),
  key_hash          TEXT NOT NULL CHECK (key_hash = 'GLOBAL' OR key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count     INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (scope, key_hash, window_started_at)
);
CREATE INDEX idx_auth_rate_limits_window ON auth_rate_limits(window_started_at);

GRANT SELECT, INSERT ON auth_rate_limits TO svc_auth;
GRANT UPDATE (request_count) ON auth_rate_limits TO svc_auth;

-- Down Migration
DROP TABLE IF EXISTS auth_rate_limits;
