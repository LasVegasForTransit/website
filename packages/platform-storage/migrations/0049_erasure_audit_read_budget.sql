-- Erasure redacts only audits of the affected people, combinations or corrections.
-- Match those targets without scanning every retained audit on a due cleanup pass.
CREATE INDEX staff_audit_target ON staff_audits(target_id);
