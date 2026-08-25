-- Up Migration
-- VibeMatch — Blueprint V1.2 §2.2

CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reported_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id  UUID REFERENCES sessions(id) ON DELETE RESTRICT,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status      TEXT NOT NULL CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','ESCALATED')) DEFAULT 'OPEN',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_report CHECK (reporter_id <> reported_id)
);
CREATE INDEX idx_reports_reported ON reports(reported_id, status);
CREATE INDEX idx_reports_severity_open ON reports(severity) WHERE status IN ('OPEN','IN_REVIEW');

CREATE TABLE moderation_cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID UNIQUE NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  assigned_to    UUID REFERENCES users(id) ON DELETE RESTRICT,
  requires_human BOOLEAN NOT NULL DEFAULT FALSE,
  decision       TEXT CHECK (decision IN
                   ('NO_ACTION','WARNING','SESSION_TERMINATED','SUSPENSION','BAN','ESCALATED')),
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_decision_has_timestamp CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CONSTRAINT chk_human_required_has_assignee
    CHECK (NOT requires_human OR decision IS NULL OR assigned_to IS NOT NULL)
);

CREATE TABLE subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  play_purchase_token  TEXT UNIQUE NOT NULL,
  plan                 TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN
                         ('ACTIVE','CANCELLED','EXPIRED','GRACE_PERIOD','REVOKED')),
  current_period_end   TIMESTAMPTZ NOT NULL,
  last_notification_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, status);

CREATE TABLE billing_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   TEXT UNIQUE NOT NULL,
  purchase_token    TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  event_time        TIMESTAMPTZ NOT NULL,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fcm_token)
);

CREATE TABLE support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')) DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_health_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('OK','DEGRADED','DOWN')),
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_health_service_time ON system_health_snapshots(service_name, captured_at);

-- Down Migration
DROP TABLE IF EXISTS system_health_snapshots;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS billing_events;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS moderation_cases;
DROP TABLE IF EXISTS reports;
