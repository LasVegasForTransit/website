-- The maintenance batch creates and removes this scope in one transaction.
-- It is never a persistent setting and cannot authorize deletion of recent history.
CREATE TABLE audit_retention_scope (
  id INTEGER PRIMARY KEY CHECK (id=1),
  run_at TEXT NOT NULL CHECK (julianday(run_at) IS NOT NULL),
  views_before TEXT NOT NULL CHECK (julianday(views_before) IS NOT NULL),
  audits_before TEXT NOT NULL CHECK (julianday(audits_before) IS NOT NULL),
  CHECK (julianday(views_before)=julianday(run_at,'-1 year')),
  CHECK (julianday(audits_before)=julianday(run_at,'-3 years'))
);
CREATE TRIGGER audit_retention_scope_no_update BEFORE UPDATE ON audit_retention_scope
BEGIN SELECT RAISE(ABORT,'retention scope cannot be changed'); END;
CREATE TRIGGER staff_audit_retention_only BEFORE DELETE ON staff_audits
WHEN NOT EXISTS (SELECT 1 FROM audit_retention_scope WHERE id=1 AND OLD.occurred_at<audits_before)
BEGIN SELECT RAISE(ABORT,'staff audits may be deleted only by retention'); END;
CREATE TRIGGER person_view_retention_only BEFORE DELETE ON person_views
WHEN NOT EXISTS (SELECT 1 FROM audit_retention_scope WHERE id=1 AND OLD.occurred_at<views_before)
BEGIN SELECT RAISE(ABORT,'record views may be deleted only by retention'); END;
CREATE TRIGGER person_view_append_only BEFORE UPDATE ON person_views
BEGIN SELECT RAISE(ABORT,'record views cannot be changed'); END;
