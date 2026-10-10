-- Featured first steps are editable campaign data. The id also identifies the
-- referring source; a visitor from that source sees an evergreen next step.
CREATE TABLE onboarding_actions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  label TEXT NOT NULL,
  href TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE INDEX onboarding_actions_current
  ON onboarding_actions (active, starts_at, ends_at, priority DESC);

INSERT INTO onboarding_actions
  (id, title, description, label, href, starts_at, ends_at, priority)
VALUES
  ('wwd', 'Take part in Week Without Driving',
   'October 1–8: try a trip without driving and tell us what you notice. Anyone can take part, even without signing up for the giveaway.',
   'See how to take part',
   'https://lvwwd.org/take-part/?utm_source=lvbt&utm_medium=welcome_email',
   '2026-09-30T07:00:00.000Z', '2026-10-09T07:00:00.000Z', 100);
