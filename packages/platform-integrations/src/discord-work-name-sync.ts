import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork } from './discord-work-authority';
import {
  currentWorkAudience,
  workFailure,
  type WorkEffectContext,
  type WorkProviders,
} from './discord-work-actions';
import { notionObject } from './notion-task-types';
import { DiscordApiFailure } from './discord-types';
import { DiscordPreDispatchTimeout } from './discord-http';
import { NameSyncPreDispatchFailure } from './discord-work-provider-names';
import { planningPage } from './discord-work-project-refresh';
import { assertProvisionCurrent } from './discord-work-provision-checkpoint';
import type {
  ProjectHome,
  WorkConversation,
  WorkOperation,
  WorkResult,
} from './discord-work-types';

interface Origin {
  actor_person_id: string;
  actor_discord_id: string;
  grant_version: string;
}
type NameTarget = 'forum' | 'thread';

export async function queuePlanningNames(
  db: Db,
  input: {
    home: ProjectHome;
    conversation: WorkConversation;
    page: { title: string; lastEditedTime: unknown };
    origin: Origin | null;
  },
  context: WorkEffectContext,
): Promise<boolean> {
  const { home, conversation: c, page, origin } = input;
  if (typeof page.lastEditedTime !== 'string' || !Number.isFinite(Date.parse(page.lastEditedTime)))
    return false;
  let queued = false;
  const targets: [NameTarget, string | undefined][] = [
    ['forum', home.kind === 'event' ? undefined : home.managedName],
    ['thread', c.managedName],
  ];
  for (const [target, previous] of targets) {
    if (!previous || previous === page.title) continue;
    const authority =
      (target === 'forum' ? home.managedNameAuthority : c.managedNameAuthority) ?? origin;
    if (!authority) continue;
    const revision =
      target === 'forum' ? (home.nameSyncRevision ?? 'created') : (c.nameSyncRevision ?? 'created');
    const result = await enqueueWorkOperation(
      db,
      {
        id: crypto.randomUUID(),
        scope: context.scope,
        homeId: home.id,
        conversationId: c.id,
        generation: c.generation,
        kind: 'refresh',
        sourceKey: `name-sync:${c.id}:${c.generation}:${target}:${revision}:${page.lastEditedTime}`,
        actorPersonId: authority.actor_person_id,
        actorDiscordId: authority.actor_discord_id,
        grantVersion: authority.grant_version,
        originalAuthorId: authority.actor_discord_id,
        payload: { intent: 'name-sync', target, title: page.title, revision },
      },
      context.clock(),
    );
    queued ||= result === 'queued';
  }
  return queued;
}

async function loadNameSync(db: Db, op: WorkOperation, context: WorkEffectContext) {
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  const c = op.conversation_id
    ? await readWorkConversation(db, context.scope, op.conversation_id)
    : null;
  const home = c ? await readProjectHome(db, context.scope, c.homeId) : null;
  if (!c || !home) throw new Error('link_changed');
  validateNameSyncLink(c, home, op, payload);
  const target: NameTarget = payload.target;
  const previous = managedTarget(c, home, target, payload.revision);
  const destination = target === 'forum' ? home.destination.channelId : c.threadId;
  const parentId = target === 'forum' ? home.destination.parentId : home.destination.channelId;
  return {
    c,
    home,
    target,
    previous,
    revision: String(payload.revision),
    title: payload.title,
    destination,
    parentId,
  };
}

function managedTarget(
  c: WorkConversation,
  home: ProjectHome,
  target: NameTarget,
  revision: unknown,
): string {
  const expected =
    target === 'forum' ? (home.nameSyncRevision ?? 'created') : (c.nameSyncRevision ?? 'created');
  const previous = target === 'forum' ? home.managedName : c.managedName;
  if (
    revision !== expected ||
    !previous ||
    (target === 'forum' && (home.kind === 'event' || home.destination.kind !== 'forum'))
  )
    throw new Error('link_changed');
  return previous;
}

async function verifyNameSync(
  db: Db,
  providers: WorkProviders,
  {
    op,
    context,
    c,
    home,
    title,
  }: {
    op: WorkOperation;
    context: WorkEffectContext;
    c: WorkConversation;
    home: ProjectHome;
    title: string;
  },
) {
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: c.subject,
      taskSourceId: context.taskSourceId,
      homeId: home.id,
      conversationId: c.id,
      generation: c.generation,
      discordUserId: op.actor_discord_id,
      action: 'manage_home',
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    throw new Error('authority_changed');
  if (!(await currentWorkAudience(db, providers, c, true))) throw new Error('audience_changed');
  const page = await planningPage(providers, c);
  if (page?.title !== title) throw new Error('link_changed');
}

export function validateNameSyncLink(
  c: WorkConversation,
  home: ProjectHome,
  op: WorkOperation,
  payload: Record<string, unknown>,
): asserts payload is Record<string, unknown> & { target: NameTarget; title: string } {
  if (
    c.state !== 'active' ||
    c.generation !== op.generation ||
    home.state !== 'active' ||
    (payload.target !== 'forum' && payload.target !== 'thread') ||
    typeof payload.title !== 'string'
  )
    throw new Error('link_changed');
}

async function saveName(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  link: Awaited<ReturnType<typeof loadNameSync>>,
) {
  const table = link.target === 'forum' ? 'discord_project_homes' : 'discord_work_conversations';
  const id = link.target === 'forum' ? link.home.id : link.c.id;
  const generation = link.target === 'forum' ? link.home.generation : link.c.generation;
  const result = await db
    .prepare(
      `UPDATE ${table} SET data_json=json_set(data_json,'$.managedName',?),updated_at=? WHERE id=? AND scope_key=? AND state='active' AND generation=? AND json_extract(data_json,'$.managedName')=? AND coalesce(json_extract(data_json,'$.nameSyncRevision'),'created')=? AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=${table}.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)`,
    )
    .bind(
      link.title,
      context.clock().toISOString(),
      id,
      op.scope_key,
      generation,
      link.previous,
      link.revision,
      op.id,
      op.claim_token,
      context.clock().toISOString(),
    )
    .run();
  if (!result.meta.changes) throw new Error('unconfirmed_effect');
}

async function stopNameManagement(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  expected: string,
) {
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  const c = op.conversation_id
    ? await readWorkConversation(db, context.scope, op.conversation_id)
    : null;
  const home = c ? await readProjectHome(db, context.scope, c.homeId) : null;
  if (!c || !home || (payload.target !== 'forum' && payload.target !== 'thread')) return false;
  const isForum = payload.target === 'forum';
  const table = isForum ? 'discord_project_homes' : 'discord_work_conversations';
  const id = isForum ? home.id : c.id;
  const generation = isForum ? home.generation : c.generation;
  const result = await db
    .prepare(
      `UPDATE ${table} SET data_json=json_set(data_json,'$.managedName',NULL,'$.managedNameReason','planning_name_changed'),updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state='active' AND json_extract(data_json,'$.managedName')=? AND coalesce(json_extract(data_json,'$.nameSyncRevision'),'created')=? AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=${table}.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)`,
    )
    .bind(
      context.clock().toISOString(),
      id,
      op.scope_key,
      generation,
      expected,
      typeof payload.revision === 'string' ? payload.revision : '',
      op.id,
      op.claim_token,
      context.clock().toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}

function checkpointMatches(
  saved: Record<string, unknown>,
  link: Awaited<ReturnType<typeof loadNameSync>>,
  current: string,
): boolean {
  return (
    (saved.previous === link.previous || link.previous === link.title) &&
    saved.title === link.title &&
    current === link.title
  );
}

async function nameSyncFailure(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  input: { error: unknown; expected: string | undefined },
): Promise<WorkResult> {
  const beforeDispatch =
    input.error instanceof NameSyncPreDispatchFailure ||
    input.error instanceof DiscordPreDispatchTimeout;
  const original =
    input.error instanceof NameSyncPreDispatchFailure ? input.error.original : input.error;
  const retry =
    original instanceof DiscordPreDispatchTimeout
      ? { state: 'retryable' as const, reason: 'dispatch_timeout', retryAfterMs: 60_000 }
      : workFailure(original);
  const safeRetry =
    beforeDispatch || (original instanceof DiscordApiFailure && original.kind === 'rate_limited');
  if (safeRetry && retry.state === 'retryable' && !op.result_json) {
    const now = context.clock();
    const retryAt = new Date(now.getTime() + Math.max(1000, retry.retryAfterMs ?? 60_000));
    const result = await db
      .prepare(
        "UPDATE discord_work_operations SET state='retryable',reason=?,result_json=NULL,next_attempt_at=?,claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>?",
      )
      .bind(
        retry.reason ?? 'retryable',
        retryAt.toISOString(),
        now.toISOString(),
        op.id,
        op.scope_key,
        op.claim_token,
        now.toISOString(),
      )
      .run();
    return { kind: 'paused', reason: result.meta.changes ? retry.reason : 'unconfirmed_effect' };
  }
  return finishNameFailure(db, op, context, { original, retry, expected: input.expected });
}

async function finishNameFailure(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
  {
    original,
    retry,
    expected,
  }: { original: unknown; retry: ReturnType<typeof workFailure>; expected: string | undefined },
): Promise<WorkResult> {
  const changed = original instanceof Error && original.message === 'planning_name_changed';
  const stopped =
    changed && expected !== undefined && (await stopNameManagement(db, op, context, expected));
  const archiveReason =
    original instanceof Error &&
    ['planning_post_archived', 'planning_post_locked'].includes(original.message)
      ? original.message
      : null;
  const outcome = stopped
    ? { state: 'failed' as const, reason: 'planning_name_changed' }
    : archiveReason
      ? { state: 'failed' as const, reason: archiveReason }
      : retry;
  await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
  return { kind: 'paused', reason: outcome.reason };
}

async function nameBeforeWrite(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<void> {
  try {
    const current = await loadNameSync(db, op, context);
    await verifyNameSync(db, providers, {
      op,
      context,
      c: current.c,
      home: current.home,
      title: current.title,
    });
    await assertProvisionCurrent(db, op, context.clock, current.home);
  } catch (error) {
    throw new NameSyncPreDispatchFailure(error);
  }
}

export async function processWorkNameSync(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  let expected: string | undefined;
  try {
    const link = await loadNameSync(db, op, context);
    expected = link.previous;
    const current = await providers.discord.readPlanningName(link.destination);
    if (op.result_json) {
      const saved = notionObject(JSON.parse(op.result_json) as unknown);
      if (!checkpointMatches(saved, link, current)) throw new Error('unconfirmed_effect');
      await verifyNameSync(db, providers, {
        op,
        context,
        c: link.c,
        home: link.home,
        title: link.title,
      });
    } else {
      if (current !== link.previous) {
        await verifyNameSync(db, providers, {
          op,
          context,
          c: link.c,
          home: link.home,
          title: link.title,
        });
        throw new Error('planning_name_changed');
      }
      const saved = await db
        .prepare(
          "UPDATE discord_work_operations SET result_json=?,updated_at=? WHERE id=? AND scope_key=? AND state='processing' AND claim_token=? AND lease_expires_at>? AND result_json IS NULL",
        )
        .bind(
          JSON.stringify({ previous: link.previous, title: link.title }),
          context.clock().toISOString(),
          op.id,
          op.scope_key,
          op.claim_token,
          context.clock().toISOString(),
        )
        .run();
      if (!saved.meta.changes) throw new Error('link_changed');
      await providers.discord.updatePlanningName({
        channelId: link.destination,
        parentId: link.parentId,
        kind: link.target,
        expectedName: link.previous,
        name: link.title,
        beforeWrite: () => nameBeforeWrite(db, providers, op, context),
      });
    }
    if (link.previous !== link.title) await saveName(db, op, context, link);
    const confirmed = await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed' },
      context.clock(),
    );
    return confirmed ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
  } catch (error) {
    return nameSyncFailure(db, op, context, { error, expected });
  }
}
