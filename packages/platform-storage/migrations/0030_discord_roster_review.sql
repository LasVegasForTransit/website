ALTER TABLE provider_scan_checkpoints ADD COLUMN pages_read INTEGER NOT NULL DEFAULT 0 CHECK(pages_read>=0);
ALTER TABLE provider_scan_checkpoints ADD COLUMN accounts_read INTEGER NOT NULL DEFAULT 0 CHECK(accounts_read>=0);
ALTER TABLE provider_scan_checkpoints ADD COLUMN unlinked_role_accounts INTEGER NOT NULL DEFAULT 0 CHECK(unlinked_role_accounts>=0);
ALTER TABLE provider_scan_checkpoints ADD COLUMN errors INTEGER NOT NULL DEFAULT 0 CHECK(errors>=0);

CREATE TABLE discord_role_reviews (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  managed_role_ids TEXT NOT NULL CHECK(json_valid(managed_role_ids) AND json_type(managed_role_ids)='array'),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_scan_id TEXT NOT NULL,
  PRIMARY KEY(guild_id,discord_user_id)
);
CREATE INDEX discord_role_reviews_seen ON discord_role_reviews(guild_id,last_seen_at,discord_user_id);
