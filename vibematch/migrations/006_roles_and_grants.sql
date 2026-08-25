-- Up Migration
-- VibeMatch — Blueprint V1.2 §2.5 — LEAST PRIVILEGE COM GRANULARIDADE DE COLUNA.
-- runtime role != table owner. Nenhuma senha real neste arquivo.
--
-- Correções aplicadas nesta revisão:
--  (1) svc_auth deixou de ter UPDATE amplo em users; agora só UPDATE(phone_verified).
--  (2) svc_profile criado; profiles saiu da autoridade do Auth.
--  (3) svc_moderation: UPDATE(status) em users e UPDATE de apenas 3 colunas em consents.
--  (4) svc_matchmaking: sem UPDATE nas colunas estruturais de consents.
--  (8) sem "ALL SEQUENCES"; grants de sequence mínimos e justificados.

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['svc_auth','svc_profile','svc_matchmaking',
                           'svc_video','svc_moderation','svc_billing'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- Base fechada: nada é público.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public
  TO svc_auth, svc_profile, svc_matchmaking, svc_video, svc_moderation, svc_billing;

-- =====================================================================
-- svc_auth — SOMENTE o domínio de autenticação.
-- Cria usuário no primeiro login, lê o que precisa, e altera APENAS
-- phone_verified. NÃO pode tocar status nem age_assurance_status.
-- status é CONSULTADO (SELECT) para negar login, nunca alterado.
-- =====================================================================
GRANT SELECT (id, google_subject_id, phone_verified, status, created_at) ON users TO svc_auth;
GRANT INSERT (google_subject_id) ON users TO svc_auth;
GRANT UPDATE (phone_verified, updated_at) ON users TO svc_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON devices TO svc_auth;

-- =====================================================================
-- svc_profile — domínio Profile/Interests (V1.2 §1.2).
-- Inclui age_assurance_status porque o Profile Service orquestra o
-- AgeAssuranceProvider (V1.2 §1.2/§6.7). NÃO pode suspender usuário.
-- =====================================================================
GRANT SELECT (id, status, age_assurance_status, phone_verified) ON users TO svc_profile;
GRANT UPDATE (age_assurance_status, updated_at) ON users TO svc_profile;
GRANT SELECT, INSERT, UPDATE ON profiles TO svc_profile;
GRANT SELECT ON interests TO svc_profile;
GRANT SELECT, INSERT, DELETE ON user_interests TO svc_profile;

-- =====================================================================
-- svc_matchmaking — escritor legítimo de consents, MAS sem poder trocar
-- participantes ou identificadores estruturais depois do INSERT.
-- Reforçado por trigger de imutabilidade estrutural (migration 003).
-- =====================================================================
GRANT SELECT, INSERT ON match_intents TO svc_matchmaking;
GRANT UPDATE (status, responded_at, closed_at) ON match_intents TO svc_matchmaking;
GRANT SELECT, INSERT ON consents TO svc_matchmaking;
GRANT UPDATE (user_a_status, user_b_status, status, cancellation_reason,
              accepted_both_at, video_deadline, expires_at, updated_at)
  ON consents TO svc_matchmaking;
-- consent_decisions: INSERT sem prev_hash/row_hash — o trigger é a autoridade (correção 7).
GRANT INSERT (consent_id, acting_user_id, decision, decided_at, auth_session_ref, request_id)
  ON consent_decisions TO svc_matchmaking;
GRANT SELECT ON users, blocks, profiles, interests, user_interests TO svc_matchmaking;

-- =====================================================================
-- svc_video — exceção documentada da V1.2 §1.3: SELECT escopado, JAMAIS escrita.
-- =====================================================================
GRANT SELECT, INSERT ON sessions TO svc_video;
GRANT UPDATE (status, end_reason, revocation_pending, revoked_at, started_at, ended_at)
  ON sessions TO svc_video;
GRANT SELECT ON consents, users, blocks TO svc_video;

-- =====================================================================
-- svc_moderation — pode suspender (UPDATE(status)) e cancelar Consent por
-- MODERATION, e nada além disso. Não pode alterar google_subject_id nem
-- as colunas estruturais de consents.
-- =====================================================================
GRANT SELECT, INSERT ON reports TO svc_moderation;
GRANT UPDATE (status) ON reports TO svc_moderation;
GRANT SELECT, INSERT ON moderation_cases TO svc_moderation;
GRANT UPDATE (assigned_to, requires_human, decision, decided_at) ON moderation_cases TO svc_moderation;
GRANT SELECT, INSERT, DELETE ON blocks TO svc_moderation;
GRANT SELECT (id, status, age_assurance_status) ON users TO svc_moderation;
GRANT UPDATE (status, updated_at) ON users TO svc_moderation;
GRANT SELECT ON consents TO svc_moderation;
GRANT UPDATE (status, cancellation_reason, updated_at) ON consents TO svc_moderation;
GRANT SELECT ON sessions TO svc_moderation;
GRANT UPDATE (status, end_reason, revocation_pending, revoked_at, ended_at)
  ON sessions TO svc_moderation;
GRANT SELECT, INSERT ON support_tickets TO svc_moderation;
GRANT UPDATE (status) ON support_tickets TO svc_moderation;

-- =====================================================================
-- svc_billing
-- =====================================================================
GRANT SELECT, INSERT ON subscriptions TO svc_billing;
GRANT UPDATE (plan, status, current_period_end, last_notification_at, updated_at)
  ON subscriptions TO svc_billing;
GRANT SELECT, INSERT ON billing_events TO svc_billing;
GRANT SELECT (id, status) ON users TO svc_billing;

-- =====================================================================
-- audit_logs — INSERT-only, e SEM as colunas de hash (correção 7).
-- O chamador fornece apenas campos legítimos do evento.
-- =====================================================================
GRANT INSERT (actor_type, actor_id, action, object_type, object_id, reason, result)
  ON audit_logs
  TO svc_auth, svc_profile, svc_matchmaking, svc_video, svc_moderation, svc_billing;

-- =====================================================================
-- system_health
-- =====================================================================
GRANT SELECT, INSERT ON system_health_snapshots
  TO svc_auth, svc_profile, svc_matchmaking, svc_video, svc_moderation, svc_billing;

-- =====================================================================
-- SEQUENCES (correção 8) — sem "ALL SEQUENCES".
-- Colunas GENERATED ALWAYS AS IDENTITY (audit_logs.id, consent_decisions.chain_seq)
-- são gerenciadas internamente pelo PostgreSQL e, em princípio, NÃO exigem
-- privilégio explícito de sequence. Nenhum GRANT de sequence é concedido aqui.
-- VERIFICAR NA EXECUÇÃO REAL: se um INSERT falhar por permissão de sequence,
-- conceder USAGE (nunca SELECT) apenas na sequence específica envolvida.
-- =====================================================================

-- Nenhum runtime role recebe ALTER, DROP, TRUNCATE, ownership, CREATE em schema,
-- ou capacidade de desabilitar triggers. Esses ficam exclusivos do owner/migration role.

-- Down Migration
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['svc_auth','svc_profile','svc_matchmaking',
                           'svc_video','svc_moderation','svc_billing'] LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r);
    EXECUTE format('DROP ROLE IF EXISTS %I', r);
  END LOOP;
END $$;
