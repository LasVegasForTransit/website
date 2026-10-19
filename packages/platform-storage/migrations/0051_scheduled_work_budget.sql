CREATE TABLE scheduled_work_budget (
  id INTEGER PRIMARY KEY CHECK(id=1),
  utc_day TEXT NOT NULL,
  charged_reads INTEGER NOT NULL CHECK(charged_reads>=0),
  charged_writes INTEGER NOT NULL CHECK(charged_writes>=0),
  lease_token TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  blocked INTEGER NOT NULL CHECK(blocked IN (0,1))
);
