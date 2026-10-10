import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import { can, PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import {
  WELCOME_METHODS,
  type WelcomeClaim,
  type WelcomeContact,
  type WelcomeMethod,
} from '@lasvegasfortransit/platform-core/welcome';
import { INTERESTS } from '@lasvegasfortransit/platform-core/join-form';
import type { Db } from './db';
import { auditDenied } from './audits';
import { loadActor } from './staff-roles';
import { canWelcomePerson, WELCOME_SCOPE } from './welcome-scope';
import { mutateWelcome, type WelcomeMutation } from './welcome-mutations';
import { welcomeQueue } from './welcome-queue';
interface Operation {
  operationId: string;
  now?: Date;
}
export class WelcomeService {
  constructor(private readonly db: Db) {}
  async list(actor: Actor, input: { cursor?: string; now?: Date; limit?: number } = {}) {
    const current = await loadActor(this.db, actor.personId);
    if (!current || !can(current, 'welcome.view')) {
      await auditDenied(this.db, actor.personId, 'welcome.view');
      throw new PermissionDenied('welcome.view');
    }
    return await welcomeQueue(this.db, actor.personId, { ...input, now: input.now ?? new Date() });
  }
  async entry(actor: Actor, personId: string, now: Date = new Date()) {
    const page = await welcomeQueue(this.db, actor.personId, { now, personId, limit: 1 });
    return page.items[0] ?? null;
  }
  async contact(
    actor: Actor,
    personId: string,
    now: Date = new Date(),
  ): Promise<WelcomeContact | null> {
    const contact = await this.db
      .prepare(
        `SELECT p.given_name AS givenName,p.family_name AS familyName,p.email,p.phone,
      coalesce((SELECT CASE WHEN json_type(e.details,'$.interests')='array' THEN json_extract(e.details,'$.interests') ELSE '[]' END FROM engagement_events e
        WHERE e.person_id=p.id AND e.type='joined' AND NOT EXISTS(SELECT 1 FROM engagement_events correction
        WHERE correction.person_id=p.id AND correction.type='correction' AND correction.reference=e.id)
        ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1),'[]') AS interests
      FROM people p JOIN welcome_claims c ON c.person_id=p.id
      WHERE p.id=? AND p.deleted_at IS NULL AND p.membership_status='member' AND c.actor_id=? AND c.expires_at>? AND ${WELCOME_SCOPE}`,
      )
      .bind(personId, actor.personId, now.toISOString(), actor.personId)
      .first<Omit<WelcomeContact, 'interests'> & { interests: string }>();
    if (!contact) return null;
    const interests: unknown = JSON.parse(contact.interests);
    return {
      ...contact,
      interests: Array.isArray(interests)
        ? INTERESTS.filter((interest) => interests.includes(interest))
        : [],
    };
  }
  claim(actor: Actor, personId: string, input: Operation): Promise<MutationResult<WelcomeClaim>> {
    return this.mutate(actor, {
      ...input,
      kind: 'claim',
      personId,
      actorId: actor.personId,
      now: input.now ?? new Date(),
    });
  }
  release(actor: Actor, personId: string, input: Operation): Promise<MutationResult<WelcomeClaim>> {
    return this.mutate(actor, {
      ...input,
      kind: 'release',
      personId,
      actorId: actor.personId,
      now: input.now ?? new Date(),
    });
  }
  complete(
    actor: Actor,
    personId: string,
    input: Operation & { method: WelcomeMethod; note: string },
  ): Promise<MutationResult<WelcomeClaim>> {
    if (!WELCOME_METHODS.includes(input.method) || input.note.length > 2000)
      return Promise.resolve({ kind: 'invalid' });
    return this.mutate(actor, {
      ...input,
      note: input.note.trim(),
      kind: 'complete',
      personId,
      actorId: actor.personId,
      now: input.now ?? new Date(),
    });
  }
  private async mutate(
    actor: Actor,
    input: WelcomeMutation,
  ): Promise<MutationResult<WelcomeClaim>> {
    if (
      !input.operationId.trim() ||
      input.operationId.length > 200 ||
      !Number.isFinite(input.now.getTime())
    )
      return { kind: 'invalid' };
    if (!(await canWelcomePerson(this.db, actor.personId, input.personId))) {
      await auditDenied(
        this.db,
        actor.personId,
        input.kind === 'complete' ? 'welcome.complete' : 'welcome.claim',
      );
      return { kind: 'forbidden' };
    }
    return await mutateWelcome(this.db, input);
  }
}
