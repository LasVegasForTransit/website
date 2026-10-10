/** Bind the current viewer ID; p is the target person in the caller's query. */
export const STAFF_PERSON_SCOPE = `EXISTS (SELECT 1 FROM people viewer
 WHERE viewer.id=? AND viewer.deleted_at IS NULL AND viewer.membership_status='member'
 AND (EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=viewer.id)
 OR EXISTS(SELECT 1 FROM committee_assignments viewer_assignment JOIN committee_assignments target_assignment
 ON target_assignment.committee_id=viewer_assignment.committee_id AND target_assignment.ended_at IS NULL
 WHERE viewer_assignment.person_id=viewer.id AND viewer_assignment.role='lead'
 AND viewer_assignment.ended_at IS NULL AND target_assignment.person_id=p.id)))`;
export const STAFF_ADMIN_SCOPE = `EXISTS (SELECT 1 FROM staff_administrators designation JOIN people viewer
 ON viewer.id=designation.person_id AND viewer.deleted_at IS NULL AND viewer.membership_status='member'
 WHERE designation.person_id=?)`;
