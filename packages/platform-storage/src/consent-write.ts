import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { ConsentScope } from '@lasvegasfortransit/platform-core/membership';
import type { ConsentSource, ConsentMethod } from './person-service';
import type { Db } from './db';

export interface ConsentWriteInput {
  scope: ConsentScope;
  source: ConsentSource;
  method: ConsentMethod;
  wordingVersion: string;
  givenAt: string;
  renew?: boolean;
}

/** Serialize new evidence against both active records and later withdrawals. */
export async function writePersonConsent(
  db: Db,
  id: string,
  input: ConsentWriteInput,
): Promise<string | null> {
  const now = nowIso(),
    consentId = ulid();
  const renew =
    input.renew === true &&
    input.scope === 'newsletter' &&
    input.source === 'account' &&
    input.method === 'checkbox';
  const saved = await db
    .prepare(
      `INSERT INTO consent_records (id, person_id, scope, given_at, source, method, wording_version, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE julianday(?) IS NOT NULL AND julianday(?)<=julianday(?)
    AND EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)
    AND (? OR NOT EXISTS(SELECT 1 FROM consent_records WHERE person_id=? AND scope=? AND withdrawn_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM consent_withdrawals WHERE (person_id=? OR origin_person_id=?) AND scope=? AND (julianday(withdrawn_at) IS NULL OR julianday(withdrawn_at)>=julianday(?)))
    AND NOT EXISTS(SELECT 1 FROM consent_records WHERE person_id=? AND scope=? AND withdrawn_at IS NOT NULL AND (julianday(withdrawn_at) IS NULL OR julianday(withdrawn_at)>=julianday(?)))`,
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
      input.givenAt,
      input.givenAt,
      now,
      id,
      Number(renew),
      id,
      input.scope,
      id,
      id,
      input.scope,
      input.givenAt,
      id,
      input.scope,
      input.givenAt,
    )
    .run();
  return saved.meta.changes ? consentId : null;
}
