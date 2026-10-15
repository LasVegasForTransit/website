/** Current membership evidence never supplies a historical consent or joining date. */
export const CURRENT_MEMBERSHIP_VERSION = 2;
export const MEMBERSHIP_STATUS_SQL = `CASE
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
  WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM consent_withdrawals w WHERE (w.person_id=people.id OR w.origin_person_id=people.id) AND w.scope='newsletter')
    OR EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.revoked_at IS NOT NULL) THEN 'former_member'
  WHEN EXISTS(SELECT 1 FROM membership_roll r WHERE r.person_id=people.id AND r.entitled=1) THEN 'member'
  ELSE 'not_member' END`;
