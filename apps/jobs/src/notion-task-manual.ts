import { syncNotionTaskSnapshot } from '@lasvegasfortransit/platform-integrations/notion-task-sync';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import { notionObject } from '@lasvegasfortransit/platform-integrations/notion-task-types';
import {
  taskCheckinWorkerRuntime,
  type TaskCheckinWorkerEnv,
} from '@lasvegasfortransit/platform-integrations/notion-task-runtime';
import { NotionTaskClient } from '@lasvegasfortransit/platform-integrations/notion-task-client';
import { DiscordTaskClient } from '@lasvegasfortransit/platform-integrations/notion-task-discord';
import { processNotionTaskAction } from '@lasvegasfortransit/platform-integrations/notion-task-actions';
import { processTaskCardRefresh } from '@lasvegasfortransit/platform-integrations/notion-task-refresh';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import { runMeteredJob } from './job-database';
import { readDiscordInput } from './discord-request';

/** Private service binding only. Process the durable human action, never the reminder queue. */
export async function handleManualTaskUpdate(
  request: Request,
  env: Env & TaskCheckinWorkerEnv,
): Promise<Response> {
  if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
    return new Response(null, { status: 400 });
  const runtime = taskCheckinWorkerRuntime(env, true);
  if (!runtime) return new Response(null, { status: 404 });
  const id = notionObject(await readDiscordInput(request)).id;
  if (!isDiscordId(id)) return new Response(null, { status: 400 });
  const result = await runMeteredJob(env.PLATFORM_DB, 'ManualTaskUpdate', async ({ db }) => {
    const action = await db
      .prepare(
        "SELECT task_id,person_id FROM task_checkin_operations WHERE id=? AND source_id=? AND kind<>'delivery'",
      )
      .bind(id, runtime.sourceId)
      .first<{ task_id: string; person_id: string }>();
    if (!action) return { kind: 'idle' };
    const clock = () => new Date();
    const notion = new NotionTaskClient(runtime.notionToken);
    const discord = new DiscordTaskClient({
      guildId: runtime.guildId,
      botToken: runtime.botToken,
      rateLimit: discordRateLimit(db, runtime.applicationId, clock),
    });
    await processNotionTaskAction(db, notion, id, {
      membership: (user, guild) => discord.membership(user, guild),
      clock,
    });
    await syncNotionTaskSnapshot(
      db,
      notion,
      { sourceId: runtime.sourceId, taskId: action.task_id },
      clock,
    );
    await processTaskCardRefresh(
      db,
      { notion, discord },
      { sourceId: runtime.sourceId, taskId: action.task_id, personId: action.person_id },
      clock,
    );
    return { kind: 'processed' };
  });
  return Response.json(result);
}
