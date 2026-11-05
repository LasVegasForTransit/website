CREATE TABLE workspace_directory_channels (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, event TEXT NOT NULL,
 token_hash TEXT NOT NULL, resource_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX workspace_channel_renewal ON workspace_directory_channels(customer_id,event,expires_at);
CREATE TABLE workspace_directory_scans (
 customer_id TEXT PRIMARY KEY, phase TEXT NOT NULL DEFAULT 'active' CHECK(phase IN ('active','deleted')),
 page_token TEXT, page_offset INTEGER NOT NULL DEFAULT 0,
 next_due_at TEXT NOT NULL, lease_hash TEXT, lease_until TEXT
);
