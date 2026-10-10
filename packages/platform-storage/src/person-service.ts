// The internal person service, version 1: the only way platform code reads
// and writes people. It enforces which source may change which field,
// records where every field came from, adds consent only with evidence, and
// recomputes membership after every consent change. See person-service.md.

import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  membershipStatus,
  type ConsentScope,
  type MembershipStatus,
} from '@lasvegasfortransit/platform-core/membership';
import type { RegionId, RegionSource } from '@lasvegasfortransit/platform-core/regions';
import type { Db, SqlValue } from './db';
import { deletePersonData } from './person-deletion';
import {
  linkPersonIdentity,
  personHasOtherHistory,
  setPersonRegion,
  type IdentityLinkInput,
} from './person-extras';
import {
  applyImportedNewsletterConsent,
  type ImportedNewsletterEvidence,
} from './imported-consent';
import { normalizeEmail, ownedFields, type FieldName } from './field-ownership';
import { findPeople, type PeopleQuery } from './people-search';
import {
  engagementCounts,
  recordEvent,
  type EngagementCounts,
  type EngagementInput,
} from './engagement';
import {
  decideMatch,
  linkMethodFor,
  queueForReview,
  type IncomingRecord,
  type MatchDecision,
} from './matching';

export { normalizeEmail } from './field-ownership';

export const PERSON_SERVICE_VERSION = 1;

export type UpsertAction = 'linked' | 'created' | 'created_and_queued';

export type Source =
  | 'join_form'
  | 'newsletter_box'
  | 'google_form'
  | 'external_form'
  | 'beehiiv'
  | 'member'
  | 'staff'
  | 'paper'
  | 'import';

export type ConsentSource =
  | 'join_form'
  | 'newsletter_box'
  | 'google_form'
  | 'external_form'
  | 'account'
  | 'beehiiv'
  | 'paper'
  | 'check_in'
  | 'import';

export type ConsentMethod = 'checkbox' | 'double_opt_in' | 'paper_signature' | 'unknown';

export type ImportedNewsletterResult =
  | { kind: 'applied'; person: Person | null }
  | { kind: 'already_applied'; person: Person | null }
  | { kind: 'needs_review' }
  | { kind: 'conflict' };

export interface PersonFields {
  given_name?: string | null;
  family_name?: string | null;
  email?: string | null;
  phone?: string | null;
  zip?: string | null;
  census_block?: string | null;
  census_block_vintage?: string | null;
  place_name?: string | null;
  preferred_language?: string;
}

export interface Person {
  id: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone: string | null;
  zip: string | null;
  census_block: string | null;
  census_block_vintage: string | null;
  place_name: string | null;
  preferred_language: string;
  membership_status: MembershipStatus;
  membership_rules_version: number | null;
  region_id: RegionId | null;
  region_source: RegionSource | null;
  created_at: string;
  updated_at: string;
}

export const PERSON_COLUMNS =
  'id, given_name, family_name, email, phone, zip, census_block, census_block_vintage, place_name, preferred_language, membership_status, membership_rules_version, region_id, region_source, created_at, updated_at';

export class PersonService {
  constructor(
    private readonly db: Db,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  async getPerson(id: string): Promise<Person | null>;
  async getPerson(
    id: string,
    options: { withCounts: true; now?: Date },
  ): Promise<(Person & { counts: EngagementCounts }) | null>;
  async getPerson(
    id: string,
    options?: { withCounts?: boolean; now?: Date },
  ): Promise<Person | (Person & { counts: EngagementCounts }) | null> {
    const person = await this.db
      .prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ? AND deleted_at IS NULL`)
      .bind(id)
      .first<Person>();
    if (!person || !options?.withCounts) return person;
    return { ...person, counts: await engagementCounts(this.db, id, options.now) };
  }

  async findByEmail(email: string): Promise<Person | null> {
    return this.db
      .prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE email = ? AND deleted_at IS NULL`)
      .bind(normalizeEmail(email))
      .first<Person>();
  }

  /** A page of people matching a query, never including deleted people. See people-search.ts. */
  findPeople(query: PeopleQuery): Promise<{ people: Person[]; nextCursor: string | null }> {
    return findPeople(this.db, query);
  }

  /**
   * Find the person a record belongs to, or create them, using the matching
   * rules in matching.ts. Then apply the fields its source owns and any
   * consent it brings. An existing person's filled-in fields are never
   * overwritten here.
   */
  async upsertFromSource(
    input: IncomingRecord & {
      consent?:
        | {
            scope: ConsentScope;
            source: ConsentSource;
            method: ConsentMethod;
            wordingVersion: string;
          }
        | undefined;
    },
  ): Promise<{ person: Person; action: UpsertAction }> {
    const decision = await decideMatch(this.db, input);
    const now = nowIso();
    let personId: string;
    let action: UpsertAction = 'linked';
    if (decision.kind === 'existing') {
      personId = decision.personId;
      await this.updateFields(personId, {
        source: input.source,
        fields: input.fields,
        onlyEmpty: true,
      });
    } else {
      personId = await this.createFromDecision(input, decision, now);
      action = decision.review.length > 0 ? 'created_and_queued' : 'created';
    }
    const emailStored = !(decision.kind === 'new' && decision.withholdEmail);
    if (input.emailVerified === true && emailStored) {
      await this.db
        .prepare(
          'UPDATE people SET email_verified_at = coalesce(email_verified_at, ?) WHERE id = ?',
        )
        .bind(now, personId)
        .run();
    }
    if (input.identity) {
      const identity = await this.linkIdentity(personId, {
        ...input.identity,
        linkMethod: linkMethodFor(decision),
      });
      if (identity.kind !== 'ok') throw new Error('person service: identity link conflict');
    }
    if (input.consent) {
      await this.recordConsent(personId, { ...input.consent, givenAt: now });
    }
    const person = await this.getPerson(personId);
    if (!person) throw new Error('person service: person vanished during upsert');
    return { person, action };
  }

  // A new person from an incoming record, queued for review when they look
  // like someone LVBT already knows.
  private async createFromDecision(
    input: IncomingRecord,
    decision: Extract<MatchDecision, { kind: 'new' }>,
    now: string,
  ): Promise<string> {
    const personId = ulid();
    await this.db
      .prepare('INSERT INTO people (id, created_at, updated_at) VALUES (?, ?, ?)')
      .bind(personId, now, now)
      .run();
    const withheld = decision.withholdEmail ? input.fields.email : undefined;
    const fields = { ...input.fields };
    if (withheld) delete fields.email;
    await this.updateFields(personId, { source: input.source, fields });
    const details = withheld ? { email: normalizeEmail(withheld) } : null;
    await queueForReview(this.db, personId, { ...decision, details }, now);
    return personId;
  }

  /**
   * Change the fields `source` owns. With `onlyEmpty`, a field already holding
   * a value is left alone, so a repeat join never overwrites what is known.
   */
  async updateFields(
    id: string,
    input: { source: Source; fields: PersonFields; onlyEmpty?: boolean; allowClear?: boolean },
  ): Promise<Person | null> {
    // Empty values are skipped unless the caller means to clear a field, as a
    // member does when they remove their phone number.
    let fields = ownedFields(input.source, input.fields, this.warn)
      .map(([name, value]): [FieldName, SqlValue] => [name, value === '' ? null : value])
      .filter(([, value]) => input.allowClear === true || value !== null);
    if (input.onlyEmpty) {
      const current = await this.getPerson(id);
      if (!current) return null;
      fields = fields.filter(([name]) => current[name] === null);
    }
    if (fields.length === 0) return this.getPerson(id);
    const now = nowIso();
    const assignments = fields.map(([name]) => `${name} = ?`).join(', ');
    const statements = [
      this.db
        .prepare(
          `UPDATE people SET ${assignments}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(...fields.map(([, value]) => value), now, id),
      ...fields.map(([name]) =>
        this.db
          .prepare(
            `INSERT INTO field_sources (person_id, field, source, confirmed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (person_id, field) DO UPDATE SET source = excluded.source,
               confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at`,
          )
          .bind(id, name, input.source, now, now, now),
      ),
    ];
    await this.db.batch(statements);
    return this.getPerson(id);
  }

  async recordConsent(
    id: string,
    input: {
      scope: ConsentScope;
      source: ConsentSource;
      method: ConsentMethod;
      wordingVersion: string;
      givenAt: string;
    },
  ): Promise<Person | null> {
    const active = await this.db
      .prepare(
        'SELECT id FROM consent_records WHERE person_id = ? AND scope = ? AND withdrawn_at IS NULL',
      )
      .bind(id, input.scope)
      .first();
    // An active consent already covers this; a second row would add nothing.
    if (!active) {
      const now = nowIso();
      const consentId = ulid();
      await this.db
        .prepare(
          `INSERT INTO consent_records (id, person_id, scope, given_at, source, method, wording_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          consentId,
          id,
          input.scope,
          input.givenAt,
          input.source,
          input.method,
          input.wordingVersion,
          now,
          now,
        )
        .run();
      if (input.scope === 'newsletter') {
        await recordEvent(this.db, id, {
          type: 'subscribed',
          occurredAt: input.givenAt,
          source: input.source,
          reference: consentId,
        });
      }
    }
    return this.recomputeMembership(id);
  }

  /** Record historical newsletter evidence tied to its stable provider identity. */
  async recordImportedNewsletterConsent(
    id: string,
    input: ImportedNewsletterEvidence,
  ): Promise<ImportedNewsletterResult> {
    const kind = await applyImportedNewsletterConsent(this.db, id, input);
    if (kind === 'applied' || kind === 'already_applied')
      return { kind, person: await this.getPerson(id) };
    return { kind };
  }

  async withdrawConsent(
    id: string,
    input: { scope: ConsentScope; source: string; withdrawnAt: string },
  ): Promise<Person | null> {
    const recordedAt = nowIso();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)
        ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
        )
        .bind(ulid(), id, id, input.scope, input.source, input.withdrawnAt, recordedAt, id),
      this.db
        .prepare(
          `UPDATE consent_records SET withdrawn_at=?,withdrawn_source=?,updated_at=?
        WHERE person_id=? AND scope=? AND withdrawn_at IS NULL`,
        )
        .bind(input.withdrawnAt, input.source, recordedAt, id, input.scope),
    ]);
    const { results } = await this.db
      .prepare(
        `SELECT id FROM consent_records WHERE person_id=? AND scope=? AND withdrawn_at=? AND withdrawn_source=? AND updated_at=?`,
      )
      .bind(id, input.scope, input.withdrawnAt, input.source, recordedAt)
      .all<{ id: string }>();
    if (input.scope === 'newsletter') {
      for (const consent of results) {
        await recordEvent(this.db, id, {
          type: 'unsubscribed',
          occurredAt: input.withdrawnAt,
          source: input.source,
          reference: consent.id,
        });
      }
    }
    return this.recomputeMembership(id);
  }

  /** Add an event to the engagement log. See engagement.ts. */
  recordEngagement(id: string, input: EngagementInput): Promise<string> {
    return recordEvent(this.db, id, input);
  }

  async linkIdentity(
    id: string,
    input: IdentityLinkInput,
  ): Promise<{ kind: 'ok'; personId: string } | { kind: 'conflict' | 'not_found' }> {
    return linkPersonIdentity(this.db, id, input);
  }

  /** Set a region if its source outranks the current one. Returns whether it changed. */
  async setRegion(id: string, regionId: RegionId, source: RegionSource): Promise<boolean> {
    return setPersonRegion(this.db, id, regionId, source);
  }

  async hasOtherHistory(id: string): Promise<boolean> {
    return personHasOtherHistory(this.db, id);
  }

  /**
   * Erase the profile and saved copies across current combinations.
   * Stable account IDs remain available for managed-access removal.
   */
  async deletePerson(id: string): Promise<void> {
    await deletePersonData(this.db, id);
  }

  private async recomputeMembership(id: string): Promise<Person | null> {
    const { results } = await this.db
      .prepare('SELECT scope, withdrawn_at AS withdrawnAt FROM consent_records WHERE person_id = ?')
      .bind(id)
      .all<{ scope: ConsentScope; withdrawnAt: string | null }>();
    await this.db
      .prepare(
        'UPDATE people SET membership_status = ?, membership_rules_version = 1, updated_at = ? WHERE id = ?',
      )
      .bind(membershipStatus(results), nowIso(), id)
      .run();
    return this.getPerson(id);
  }
}
