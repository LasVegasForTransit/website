-- LVBT regions, each person's place and region, and the small tables the
-- join form needs: rate limits and one-time form tokens.

CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO regions (id, name, sort_order, created_at, updated_at) VALUES
  ('downtown', 'Downtown', 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('east_las_vegas', 'East Las Vegas', 2, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('north_las_vegas', 'North Las Vegas', 3, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('northwest', 'Northwest', 4, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('summerlin', 'Summerlin', 5, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('central_west_las_vegas', 'Central / West Las Vegas', 6, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('paradise_strip', 'Paradise & the Strip', 7, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('southwest', 'Southwest', 8, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('henderson_boulder_city', 'Henderson & Boulder City', 9, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
  ('outside_valley', 'Outside the valley', 10, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z');

-- For each ZIP code, the share of its 2020 population in each region. A ZIP
-- sets a region only when one share is at least 0.9. Loaded by a later
-- migration built from Census relationship files.
CREATE TABLE zip_regions (
  zip TEXT NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions (id),
  population_share REAL NOT NULL CHECK (population_share >= 0 AND population_share <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (zip, region_id)
);

ALTER TABLE people ADD COLUMN place_name TEXT;
ALTER TABLE people ADD COLUMN region_id TEXT REFERENCES regions (id);
ALTER TABLE people ADD COLUMN region_source TEXT
  CHECK (region_source IS NULL OR region_source IN ('staff', 'address', 'member_choice', 'zip'));
ALTER TABLE people ADD COLUMN region_set_at TEXT;

CREATE INDEX people_region ON people (region_id) WHERE deleted_at IS NULL;

-- Sliding counters for abuse limits, keyed by a hashed caller (never a raw
-- IP address) and the start of the counting window.
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

-- One row per join form token that has been used, so submitting the same
-- form twice joins the person once.
CREATE TABLE form_submissions (
  form_token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
