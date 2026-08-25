-- Up Migration
-- VibeMatch — Blueprint V1.2 §12 (Audit Model) — TAMPER-EVIDENT, não tamper-proof.
--
-- Correções aplicadas nesta revisão:
--  (6) verify_audit_chain valida AGORA as DUAS propriedades: elo (prev_hash) e conteúdo (row_hash).
--  (5) toda função SECURITY DEFINER tem SET search_path explícito e EXECUTE revogado de PUBLIC.
--  (7) o chamador NÃO fornece prev_hash/row_hash; o trigger é a única autoridade.

CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('USER','ADMIN','SYSTEM')),
  actor_id    UUID,
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   UUID,
  reason      TEXT,
  result      TEXT,
  prev_hash   TEXT,
  row_hash    TEXT NOT NULL,   -- preenchido pelo trigger BEFORE INSERT. NOT NULL é
                               -- verificado APÓS triggers BEFORE ROW, então o chamador
                               -- pode (e deve) omitir esta coluna.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_object ON audit_logs(object_type, object_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE OR REPLACE FUNCTION audit_canonical_payload(
  p_id BIGINT, p_actor_type TEXT, p_actor_id UUID, p_action TEXT,
  p_object_type TEXT, p_object_id UUID, p_reason TEXT, p_result TEXT, p_created_at TIMESTAMPTZ
) RETURNS TEXT AS $$
  SELECT concat_ws('|',
    p_id::TEXT, p_actor_type, coalesce(p_actor_id::TEXT,''), p_action,
    p_object_type, coalesce(p_object_id::TEXT,''), coalesce(p_reason,''),
    coalesce(p_result,''), to_char(p_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'));
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION audit_link_hash(p_prev TEXT, p_payload TEXT)
RETURNS TEXT AS $$
  SELECT encode(sha256(convert_to(coalesce(p_prev,'GENESIS') || '|' || p_payload, 'UTF8')), 'hex');
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;

-- SECURITY DEFINER: o runtime tem INSERT-only (sem SELECT) em audit_logs, mas o
-- encadeamento precisa ler o row_hash anterior. Ver docs/DECISIONS.md D-IMPL-01.
CREATE OR REPLACE FUNCTION audit_logs_hash_chain()
RETURNS TRIGGER AS $$
DECLARE last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('vibematch.audit_logs.chain'));
  SELECT row_hash INTO last_hash FROM public.audit_logs ORDER BY id DESC LIMIT 1;
  -- O trigger é a ÚNICA autoridade: valor enviado pelo chamador é descartado.
  NEW.prev_hash := last_hash;
  NEW.row_hash  := public.audit_link_hash(
      last_hash,
      public.audit_canonical_payload(NEW.id, NEW.actor_type, NEW.actor_id, NEW.action,
        NEW.object_type, NEW.object_id, NEW.reason, NEW.result, NEW.created_at));
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER trg_audit_logs_hash_chain
BEFORE INSERT ON audit_logs FOR EACH ROW
EXECUTE FUNCTION audit_logs_hash_chain();

-- Verificador corrigido: valida ELO e CONTEÚDO separadamente.
-- Antes, alterar apenas prev_hash não era detectado — bug real, corrigido aqui.
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE (broken_at BIGINT, failure TEXT, expected TEXT, actual TEXT) AS $$
DECLARE r RECORD; running TEXT := NULL; computed TEXT;
BEGIN
  FOR r IN SELECT * FROM public.audit_logs ORDER BY id ASC LOOP
    IF r.prev_hash IS DISTINCT FROM running THEN
      broken_at := r.id; failure := 'PREV_HASH_LINK_MISMATCH';
      expected := coalesce(running,'<NULL genesis>'); actual := coalesce(r.prev_hash,'<NULL>');
      RETURN NEXT; RETURN;
    END IF;
    computed := public.audit_link_hash(running,
        public.audit_canonical_payload(r.id, r.actor_type, r.actor_id, r.action,
          r.object_type, r.object_id, r.reason, r.result, r.created_at));
    IF computed IS DISTINCT FROM r.row_hash THEN
      broken_at := r.id; failure := 'ROW_HASH_CONTENT_MISMATCH';
      expected := computed; actual := r.row_hash;
      RETURN NEXT; RETURN;
    END IF;
    running := r.row_hash;
  END LOOP;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ===== consent_decisions: mesma fundação, mesmo verificador de duas propriedades =====
CREATE OR REPLACE FUNCTION consent_decision_canonical_payload(
  p_consent_id UUID, p_acting_user_id UUID, p_decision TEXT,
  p_decided_at TIMESTAMPTZ, p_auth_session_ref TEXT, p_request_id UUID
) RETURNS TEXT AS $$
  SELECT concat_ws('|', p_consent_id::TEXT, p_acting_user_id::TEXT, p_decision,
    to_char(p_decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
    p_auth_session_ref, p_request_id::TEXT);
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION consent_decisions_hash_chain()
RETURNS TRIGGER AS $$
DECLARE last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('vibematch.consent_decisions.chain'));
  SELECT row_hash INTO last_hash FROM public.consent_decisions ORDER BY chain_seq DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.row_hash  := public.audit_link_hash(
      last_hash,
      public.consent_decision_canonical_payload(NEW.consent_id, NEW.acting_user_id,
        NEW.decision, NEW.decided_at, NEW.auth_session_ref, NEW.request_id));
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER trg_consent_decisions_hash_chain
BEFORE INSERT ON consent_decisions FOR EACH ROW
EXECUTE FUNCTION consent_decisions_hash_chain();

CREATE OR REPLACE FUNCTION verify_consent_decision_chain()
RETURNS TABLE (broken_at BIGINT, failure TEXT, expected TEXT, actual TEXT) AS $$
DECLARE r RECORD; running TEXT := NULL; computed TEXT;
BEGIN
  FOR r IN SELECT * FROM public.consent_decisions ORDER BY chain_seq ASC LOOP
    IF r.prev_hash IS DISTINCT FROM running THEN
      broken_at := r.chain_seq; failure := 'PREV_HASH_LINK_MISMATCH';
      expected := coalesce(running,'<NULL genesis>'); actual := coalesce(r.prev_hash,'<NULL>');
      RETURN NEXT; RETURN;
    END IF;
    computed := public.audit_link_hash(running,
        public.consent_decision_canonical_payload(r.consent_id, r.acting_user_id,
          r.decision, r.decided_at, r.auth_session_ref, r.request_id));
    IF computed IS DISTINCT FROM r.row_hash THEN
      broken_at := r.chain_seq; failure := 'ROW_HASH_CONTENT_MISMATCH';
      expected := computed; actual := r.row_hash;
      RETURN NEXT; RETURN;
    END IF;
    running := r.row_hash;
  END LOOP;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ===== Correção (5): nenhuma função privilegiada executável por PUBLIC =====
REVOKE ALL ON FUNCTION audit_logs_hash_chain()         FROM PUBLIC;
REVOKE ALL ON FUNCTION consent_decisions_hash_chain()  FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_audit_chain()            FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_consent_decision_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_link_hash(TEXT,TEXT)      FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_canonical_payload(
  BIGINT,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION consent_decision_canonical_payload(
  UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID)                FROM PUBLIC;

-- Funções de trigger não precisam de GRANT EXECUTE ao runtime: são invocadas pelo
-- mecanismo de trigger, não diretamente. Os verificadores são ferramentas
-- ADMINISTRATIVAS: nenhum papel de runtime recebe EXECUTE sobre eles.

-- Down Migration
DROP TRIGGER IF EXISTS trg_consent_decisions_hash_chain ON consent_decisions;
DROP FUNCTION IF EXISTS verify_consent_decision_chain();
DROP FUNCTION IF EXISTS consent_decisions_hash_chain();
DROP FUNCTION IF EXISTS consent_decision_canonical_payload(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,UUID);
DROP TRIGGER IF EXISTS trg_audit_logs_hash_chain ON audit_logs;
DROP FUNCTION IF EXISTS verify_audit_chain();
DROP FUNCTION IF EXISTS audit_logs_hash_chain();
DROP FUNCTION IF EXISTS audit_link_hash(TEXT,TEXT);
DROP FUNCTION IF EXISTS audit_canonical_payload(BIGINT,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ);
DROP TABLE IF EXISTS audit_logs;
