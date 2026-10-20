-- The retention cutoff compares parsed dates so offsets keep their meaning.
-- Match that expression instead of scanning every active profile each day.
CREATE INDEX people_inactive_created
  ON people(julianday(created_at),created_at,id) WHERE deleted_at IS NULL;
