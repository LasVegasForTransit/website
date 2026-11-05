-- Google has its own smaller allowance; it cannot reserve the scheduled
-- Discord/newsletter budget. Unsettled requests retain their full charge.
CREATE TABLE workspace_connector_budget (
 id INTEGER PRIMARY KEY CHECK(id=1), utc_day TEXT NOT NULL,
 charged_reads INTEGER NOT NULL, charged_writes INTEGER NOT NULL,
 blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE workspace_connector_reservations (
 token TEXT PRIMARY KEY, utc_day TEXT NOT NULL, reads INTEGER NOT NULL, writes INTEGER NOT NULL
);
