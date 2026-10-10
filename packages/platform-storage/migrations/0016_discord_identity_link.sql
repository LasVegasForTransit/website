-- A member's OAuth authorization is bound to one live signed-in session.
-- No Discord access or refresh tokens are stored.
CREATE TABLE discord_link_states (
  state_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
  origin_url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claim_token TEXT,
  claimed_at TEXT,
  completed_at TEXT
);
CREATE INDEX discord_link_expiry ON discord_link_states(expires_at);
CREATE INDEX discord_link_session ON discord_link_states(session_hash);

-- OAuth identifies the account; it does not establish server presence or roles.
CREATE TABLE discord_identity_profiles (
  identity_record_id TEXT PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT,
  verified_at TEXT NOT NULL
);
