-- Up Migration
-- Distributed fixed-window rate limits for restricted endpoints.
-- Separate tables preserve least privilege between matchmaking and video domains.

CREATE TABLE matchmaking_rate_limits (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL CHECK (scope = 'CONSENT_DECISION'),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count     INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (user_id, scope, window_started_at)
);
CREATE INDEX idx_matchmaking_rate_limits_window ON matchmaking_rate_limits(window_started_at);

CREATE TABLE video_rate_limits (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL CHECK (scope IN ('SESSION_CREATE','TOKEN')),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count     INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (user_id, scope, window_started_at)
);
CREATE INDEX idx_video_rate_limits_window ON video_rate_limits(window_started_at);

GRANT SELECT, INSERT ON matchmaking_rate_limits TO svc_matchmaking;
GRANT UPDATE (request_count) ON matchmaking_rate_limits TO svc_matchmaking;

GRANT SELECT, INSERT ON video_rate_limits TO svc_video;
GRANT UPDATE (request_count) ON video_rate_limits TO svc_video;

-- Down Migration
DROP TABLE IF EXISTS video_rate_limits;
DROP TABLE IF EXISTS matchmaking_rate_limits;
