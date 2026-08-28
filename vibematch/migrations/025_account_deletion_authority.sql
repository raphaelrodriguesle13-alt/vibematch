-- Up Migration
-- Dedicated least-privilege authority for user-initiated account deletion.
-- svc_auth remains unable to UPDATE users.status.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_account') THEN
    CREATE ROLE svc_account NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO svc_account;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status
    INTO v_status
    FROM public.users
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_status = 'DELETED' THEN
    RETURN 'DELETED';
  END IF;

  IF v_status <> 'PENDING_DELETION' THEN
    UPDATE public.users
       SET status = 'PENDING_DELETION',
           updated_at = clock_timestamp()
     WHERE id = p_user_id;
  END IF;

  RETURN 'PENDING_DELETION';
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(UUID) TO svc_account;

-- Down Migration
REVOKE EXECUTE ON FUNCTION public.request_account_deletion(UUID) FROM svc_account;
DROP FUNCTION IF EXISTS public.request_account_deletion(UUID);
REVOKE USAGE ON SCHEMA public FROM svc_account;
DROP ROLE IF EXISTS svc_account;
