import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  mayReplaceRegion,
  type RegionId,
  type RegionSource,
} from '@lasvegasfortransit/platform-core/regions';
import type { Db } from './db';

export interface IdentityLinkInput {
  platform: 'beehiiv' | 'notion_intake' | 'google_workspace' | 'discord' | 'givebutter' | 'luma';
  externalId: string;
  externalEmail?: string;
  linkMethod: 'verified_email' | 'staff_confirmed' | 'self_linked' | 'created_by_platform';
}

export async function linkPersonIdentity(
  db: Db,
  personId: string,
  input: IdentityLinkInput,
): Promise<{ kind: 'ok'; personId: string } | { kind: 'conflict' | 'not_found' }> {
  const person = await db
    .prepare('SELECT 1 AS found FROM people WHERE id=? AND deleted_at IS NULL')
    .bind(personId)
    .first();
  if (!person) return { kind: 'not_found' };

  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO identities (id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)
       ON CONFLICT(platform,external_id) DO NOTHING`,
    )
    .bind(
      ulid(),
      personId,
      input.platform,
      input.externalId,
      input.externalEmail ?? null,
      now,
      input.linkMethod,
      now,
      now,
      personId,
    )
    .run();
  const owner = await db
    .prepare(
      `SELECT i.person_id FROM identities i JOIN people p ON p.id=i.person_id
       WHERE i.platform=? AND i.external_id=? AND p.deleted_at IS NULL`,
    )
    .bind(input.platform, input.externalId)
    .first<{ person_id: string }>();
  return owner?.person_id === personId ? { kind: 'ok', personId } : { kind: 'conflict' };
}

export async function setPersonRegion(
  db: Db,
  personId: string,
  regionId: RegionId,
  source: RegionSource,
): Promise<boolean> {
  const person = await db
    .prepare('SELECT region_source FROM people WHERE id=? AND deleted_at IS NULL')
    .bind(personId)
    .first<{ region_source: RegionSource | null }>();
  if (!person || !mayReplaceRegion(person.region_source, source)) return false;
  const now = nowIso();
  await db
    .prepare(
      'UPDATE people SET region_id=?,region_source=?,region_set_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL',
    )
    .bind(regionId, source, now, now, personId)
    .run();
  return true;
}

export async function personHasOtherHistory(db: Db, personId: string): Promise<boolean> {
  const identity = await db
    .prepare("SELECT 1 AS found FROM identities WHERE person_id=? AND platform<>'beehiiv' LIMIT 1")
    .bind(personId)
    .first();
  if (identity) return true;
  const event = await db
    .prepare(
      "SELECT 1 AS found FROM engagement_events WHERE person_id=? AND type NOT IN ('joined','subscribed','unsubscribed') LIMIT 1",
    )
    .bind(personId)
    .first();
  return event !== null;
}
