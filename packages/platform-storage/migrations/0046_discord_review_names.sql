-- Provider names help staff recognize unlinked accounts; they never establish identity ownership.
ALTER TABLE discord_role_reviews ADD COLUMN username TEXT CHECK(username IS NULL OR length(username) BETWEEN 1 AND 32);
ALTER TABLE discord_role_reviews ADD COLUMN display_name TEXT CHECK(display_name IS NULL OR length(display_name)<=32);
ALTER TABLE discord_role_reviews ADD COLUMN nickname TEXT CHECK(nickname IS NULL OR length(nickname)<=32);

-- Keep only the opaque Discord subject so a completed disconnect cannot defeat erasure.
CREATE TABLE discord_erased_accounts (
  discord_user_id TEXT PRIMARY KEY NOT NULL
);
INSERT INTO discord_erased_accounts(discord_user_id)
SELECT DISTINCT i.external_id FROM identities i JOIN person_keys k ON k.id=i.person_id
WHERE i.platform='discord' AND k.erased_at IS NOT NULL;

-- Erasure keeps opaque account IDs for role removal, but clears identifying snapshots immediately.
-- The permanent key survives physical profile retention, and roster writes also honor its erased state.
CREATE TRIGGER discord_review_names_erasure AFTER UPDATE OF erased_at ON person_keys
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO discord_erased_accounts(discord_user_id)
  SELECT external_id FROM identities WHERE person_id=NEW.id AND platform='discord';
  UPDATE discord_role_reviews SET username=NULL,display_name=NULL,nickname=NULL
  WHERE discord_user_id IN (SELECT external_id FROM identities WHERE person_id=NEW.id AND platform='discord');
END;
