import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { assertProvisionCurrent } from './discord-work-provision-checkpoint';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkConversation, ProjectHome } from './discord-work-types';
import type { WorkResult } from './discord-work-types';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { authorizeWork } from './discord-work-authority';
import { currentWorkAudience, workFailure } from './discord-work-actions';
import { notionObject } from './notion-task-types';
type Payload = Record<string, unknown>;

export async function queueProjectPins(
  db: Db,
  c: WorkConversation,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<void> {
  if (c.subject.kind !== 'project_plan') return;
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  await enqueueWorkOperation(
    db,
    {
      id: crypto.randomUUID(),
      scope: context.scope,
      homeId: c.homeId,
      conversationId: c.id,
      generation: c.generation,
      kind: 'refresh',
      sourceKey: `project-pins:${c.id}:${c.generation}`,
      actorPersonId: op.actor_person_id,
      actorDiscordId: op.actor_discord_id,
      grantVersion: op.grant_version,
      originalAuthorId: op.original_author_id,
      payload: { intent: 'project-pins', createForum: payload.createForum === true },
    },
    context.clock(),
  );
}

async function pinLink(db: Db, op: WorkOperation, context: WorkEffectContext) {
  const c = op.conversation_id
    ? await readWorkConversation(db, context.scope, op.conversation_id)
    : null;
  const home = c ? await readProjectHome(db, context.scope, c.homeId) : null;
  if (
    c?.state !== 'active' ||
    c.generation !== op.generation ||
    home?.state !== 'active' ||
    c.subject.kind !== 'project_plan'
  )
    throw new Error('link_changed');
  return { c, home };
}

export async function recoverProjectPins(
  db: Db,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  const result = await db
    .prepare(
      "UPDATE discord_work_operations SET state='queued',attempts=0,next_attempt_at=?,reason='recovered_pins',updated_at=? WHERE id=? AND scope_key=? AND state='held' AND EXISTS(SELECT 1 FROM discord_work_conversations c JOIN discord_project_homes h ON h.id=c.home_id AND h.scope_key=c.scope_key WHERE c.id=discord_work_operations.conversation_id AND c.scope_key=discord_work_operations.scope_key AND c.generation=discord_work_operations.generation AND c.state='active' AND h.state='active')",
    )
    .bind(context.clock().toISOString(), context.clock().toISOString(), op.id, op.scope_key)
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

export async function pinProjectOverview(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  {
    op,
    p,
    home,
    existing,
    c,
  }: {
    op: WorkOperation;
    p: Payload;
    home: ProjectHome;
    existing: ProjectHome | null;
    c: WorkConversation;
  },
): Promise<void> {
  if (!existing?.overviewPin) {
    await assertProvisionCurrent(db, op, context.clock, home);
    let pin: 'pinned' | 'needs_attention' = 'pinned';
    try {
      await providers.discord.pinWorkMessage(c.cardChannelId ?? c.threadId, c.starterMessageId);
    } catch {
      pin = 'needs_attention';
    }
    await db
      .prepare(
        "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.overviewPin',?) WHERE id=? AND scope_key=? AND generation=? AND state='active' AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_project_homes.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)",
      )
      .bind(
        pin,
        home.id,
        op.scope_key,
        home.generation,
        op.id,
        op.claim_token,
        context.clock().toISOString(),
      )
      .run();
  }
  if (home.destination.kind === 'forum' && p.createForum === true && !existing?.overviewPostPin) {
    await assertProvisionCurrent(db, op, context.clock, home);
    let pin: 'pinned' | 'needs_attention' = 'pinned';
    try {
      await providers.discord.pinForumPost(home.destination.channelId, c.threadId);
    } catch {
      pin = 'needs_attention';
    }
    await db
      .prepare(
        "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.overviewPostPin',?) WHERE id=? AND scope_key=? AND generation=? AND state='active' AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_project_homes.scope_key AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)",
      )
      .bind(
        pin,
        home.id,
        op.scope_key,
        home.generation,
        op.id,
        op.claim_token,
        context.clock().toISOString(),
      )
      .run();
  }
}

export async function processWorkProjectPins(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || op.state !== 'processing') return { kind: 'idle' };
  try {
    const { c, home } = await pinLink(db, op, context);
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
    if (!(await currentWorkAudience(db, providers, c))) throw new Error('audience_changed');
    const p = notionObject(JSON.parse(op.payload_json) as unknown);
    await pinProjectOverview(db, providers, context, { op, p, home, existing: home, c });
    const confirmed = await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed' },
      context.clock(),
    );
    return confirmed ? { kind: 'progress' } : { kind: 'paused', reason: 'unconfirmed_effect' };
  } catch (error) {
    const outcome = workFailure(error);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, outcome, context.clock());
    return { kind: 'paused', reason: outcome.reason };
  }
}
