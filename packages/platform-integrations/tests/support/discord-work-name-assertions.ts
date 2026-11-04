import assert from 'node:assert/strict';
import { saveWorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-links';
import type { WorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { runWorkPreview } from '../../src/discord-work-setup';
import type { WorkEffectContext, WorkProviders } from '../../src/discord-work-actions';
import { discordUserId, projectId, workNow, workScope } from './discord-work';
import type { workFixture } from './discord-work';

export async function assertResolutionBlocked(input: {
  db: ReturnType<typeof workFixture>['db'];
  providers: WorkProviders;
  conversation: WorkConversation;
  threadId: string;
  context: WorkEffectContext;
}) {
  const { db, providers, conversation, threadId, context } = input;
  await saveWorkConversation(
    db,
    {
      ...conversation,
      id: 'other-link',
      subject: { ...conversation.subject, pageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      managedName: 'Other owner',
    },
    0,
    workNow,
  );
  const blocked = await runWorkPreview(
    db,
    providers,
    {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: threadId,
      interactionId: '999999999999999998',
      intent: { action: 'resolve-name', url: `https://www.notion.so/${projectId}` },
    },
    context,
  );
  assert.match(JSON.stringify(blocked), /another link manages/);
  assert.ok(
    db.raw
      .prepare(
        "SELECT 1 FROM discord_work_operations WHERE state='held' AND reason='unconfirmed_effect'",
      )
      .get(),
  );
  db.raw
    .prepare("UPDATE discord_work_conversations SET state='unlinked' WHERE id='other-link'")
    .run();
}
