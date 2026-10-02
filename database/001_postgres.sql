BEGIN;
CREATE TABLE IF NOT EXISTS invitation_admins (
  id uuid PRIMARY KEY,
  slot smallint NOT NULL UNIQUE CHECK (slot IN (1, 2)),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invitation_sessions (
  token_hash text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES invitation_admins(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitation_sessions_expiry ON invitation_sessions(expires_at);
CREATE TABLE IF NOT EXISTS invitation_registrations (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  church text NOT NULL CHECK (length(church) BETWEEN 1 AND 100 AND church = trim(church)),
  children_count integer NOT NULL CHECK (children_count BETWEEN 1 AND 1000),
  participation text CHECK (participation IS NULL OR length(participation) BETWEEN 1 AND 5000),
  participation_token_hash text NOT NULL,
  original_church text NOT NULL,
  original_children_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitation_registrations_created ON invitation_registrations(created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS invitation_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitation_rate_lookup ON invitation_rate_events(scope, key_hash, created_at);
-- No table or function is exposed to browser roles. Only the server DB role connects.
REVOKE ALL ON invitation_admins, invitation_sessions, invitation_registrations, invitation_rate_events FROM PUBLIC;
COMMIT;
