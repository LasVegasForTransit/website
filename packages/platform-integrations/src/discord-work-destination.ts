import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { settleWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { resolveWorkActor } from './discord-work-authority';
import { notionObject } from './notion-task-types';
import { workFailure, type WorkProviders, type WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkResult } from './discord-work-types';

type DestinationRequest = {
  name: string;
  audienceFingerprint: string;
} & ({ kind: 'category' } | { kind: 'text' | 'forum'; parentId: string });

function destinationRequest(op: WorkOperation): DestinationRequest {
  const p = notionObject(JSON.parse(op.payload_json) as unknown);
  if (
    p.intent !== 'destination' ||
    (p.kind !== 'text' && p.kind !== 'forum' && p.kind !== 'category') ||
    typeof p.name !== 'string' ||
    typeof p.audienceFingerprint !== 'string'
  )
    throw new Error('invalid_destination_request');
  const base = { name: p.name, audienceFingerprint: p.audienceFingerprint };
  if (p.kind === 'category') return { ...base, kind: p.kind };
  if (typeof p.parentId !== 'string') throw new Error('invalid_destination_request');
  return { ...base, kind: p.kind, parentId: p.parentId };
}

async function checkDestinationAuthority(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<void> {
  const actor = await resolveWorkActor(db, context.scope, op.actor_discord_id);
  if (
    !actor?.administrator ||
    actor.personId !== op.actor_person_id ||
    actor.grantVersion !== op.grant_version ||
    !(await providers.discord.membership(op.actor_discord_id, context.scope.guildId))
  )
    throw new Error('authority_changed');
}

async function checkDestinationParent(providers: WorkProviders, request: DestinationRequest) {
  const parent =
    request.kind === 'category'
      ? await providers.discord.inspectGuildPlacement()
      : await providers.discord.inspectDestination(request.parentId);
  if (
    (request.kind !== 'category' &&
      (!('isCategory' in parent) ||
        !parent.isCategory ||
        !('canRead' in parent) ||
        !parent.canRead)) ||
    !parent.canManageChannels ||
    parent.audienceFingerprint !== request.audienceFingerprint
  )
    throw new Error('audience_changed');
}

async function createOrRecoverDestination(
  providers: WorkProviders,
  request: DestinationRequest,
  op: WorkOperation,
) {
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : {});
  if (typeof prior.channelId === 'string') {
    const found =
      request.kind === 'category'
        ? await providers.discord.findCreatedCategory(op.id)
        : await providers.discord.findRouteDestination({
            kind: request.kind,
            parentId: request.parentId,
            operationId: op.id,
          });
    if (found !== prior.channelId) throw new Error('unconfirmed_effect');
    return {
      channelId: prior.channelId,
      parentId: request.kind === 'category' ? null : request.parentId,
    };
  }
  return providers.discord.createRouteDestination({
    kind: request.kind,
    name: request.name,
    ...(request.kind === 'category' ? {} : { parentId: request.parentId }),
    operationId: op.id,
  });
}

/** Execute an approved destination creation; unknown provider outcomes are held for review. */
export async function processWorkDestination(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  try {
    const request = destinationRequest(op);
    await checkDestinationAuthority(db, providers, op, context);
    await checkDestinationParent(providers, request);
    const current = await db
      .prepare(
        "SELECT 1 FROM discord_work_operations WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>?",
      )
      .bind(op.id, op.scope_key, op.claim_token, context.clock().toISOString())
      .first();
    if (!current) throw new Error('link_changed');
    const result = await createOrRecoverDestination(providers, request, op);
    const saved = await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed', providerIds: result },
      context.clock(),
    );
    return saved ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
  } catch (error) {
    const outcome = workFailure(error);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
    return { kind: 'paused', reason: outcome.reason };
  }
}
