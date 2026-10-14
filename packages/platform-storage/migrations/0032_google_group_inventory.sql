-- Complete, replaceable provider checks. Account keys are operational data;
-- names and contact profiles remain in the canonical membership records.
CREATE TABLE google_group_inventory (
  context_id TEXT NOT NULL,
  group_email TEXT NOT NULL,
  group_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  started_at TEXT NOT NULL CHECK(julianday(started_at) IS NOT NULL),
  observed_at TEXT NOT NULL CHECK(julianday(observed_at)>=julianday(started_at)),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at)>julianday(observed_at)),
  member_count INTEGER NOT NULL CHECK(member_count BETWEEN 0 AND 10000),
  user_count INTEGER CHECK(user_count BETWEEN 0 AND member_count),
  PRIMARY KEY(context_id,group_email)
);
CREATE INDEX google_group_inventory_age ON google_group_inventory(observed_at);
CREATE TABLE google_group_inventory_members (
  context_id TEXT NOT NULL,
  group_email TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_type TEXT NOT NULL CHECK(member_type IN ('USER','GROUP','CUSTOMER','EXTERNAL')),
  member_role TEXT NOT NULL CHECK(member_role IN ('MEMBER','MANAGER','OWNER')),
  PRIMARY KEY(context_id,group_email,member_id),
  FOREIGN KEY(context_id,group_email) REFERENCES google_group_inventory(context_id,group_email) ON DELETE CASCADE
);
CREATE INDEX google_group_member_identity ON google_group_inventory_members(member_id,context_id);
CREATE TABLE google_group_check_failures (
  context_id TEXT NOT NULL,
  group_email TEXT NOT NULL,
  failure TEXT NOT NULL CHECK(failure IN ('provider_unavailable','rate_limited','permission_denied','unknown')),
  started_at TEXT NOT NULL CHECK(julianday(started_at) IS NOT NULL),
  PRIMARY KEY(context_id,group_email)
);
