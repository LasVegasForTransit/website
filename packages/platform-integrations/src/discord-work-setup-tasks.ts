import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  listProjectHomes,
  listWorkConversations,
  findWorkSubject,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { resolveWorkActor, readWorkSource, authorizeWork } from './discord-work-authority';
import { readNotionProjectLeads } from './notion-task-projects';
import { notionObject } from './notion-task-types';
import { parseNotionTaskPage } from './notion-task-reader';
import { workSubject, workString } from './discord-work-input';
import { workMessage, workText, workCustomId } from './discord-work-cards';
import { setupReply, setupReceipt, ownedReceipt, receiptCard } from './discord-work-setup-common';
import { prepareTaskLink } from './discord-work-setup-links';
import { workMessageKey } from './discord-work-ingest';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
import type { ProjectHome, WorkSubject, WorkActor, WorkMessage } from './discord-work-types';
interface TaskChoice {
  title: string;
  subject: WorkSubject;
}
async function choices(
  db: Db,
  providers: WorkProviders,
  input: { home: ProjectHome; actor: WorkActor; cursor?: string | null },
  context: WorkEffectContext,
) {
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  if (!source) return { tasks: [], nextCursor: null, canPlace: false };
  const leads = await readNotionProjectLeads(
    providers.notion,
    input.home.projectId,
    input.home.projectSourceId,
    source.policy.projectLeadField,
  );
  const canPlace =
    input.actor.administrator ||
    Boolean(leads?.some((id) => input.actor.notionUserIds.includes(id)));
  if (!canPlace && !input.actor.notionUserIds.length)
    return { tasks: [], nextCursor: null, canPlace: false };
  const page = await providers.notion.queryTasksForProject({
    sourceId: source.source.id,
    projectField: source.policy.fields.project,
    projectId: input.home.projectId,
    assigneeField: source.policy.fields.assignee,
    assigneeId: canPlace ? undefined : input.actor.notionUserIds[0],
    cursor: input.cursor,
  });
  const tasks: TaskChoice[] = [];
  for (const value of page.results) {
    const parsed = parseNotionTaskPage(value, { ...source.policy, sourceId: source.source.id });
    const id = notionObject(value).id;
    if (
      parsed &&
      typeof id === 'string' &&
      parsed.snapshot.projectIds.includes(input.home.projectId)
    )
      tasks.push({
        title: parsed.snapshot.title,
        subject: { kind: 'task', sourceId: source.source.id, pageId: id },
      });
  }
  return { tasks, nextCursor: page.nextCursor, canPlace };
}
function choiceCard(input: {
  receiptId: string;
  action: string;
  options: { label: string; value: string }[];
  placeholder: string;
  more?: boolean;
}): WorkPreviewResult {
  const components = [
    workText(input.placeholder),
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: workCustomId({ id: input.receiptId, generation: 1 }, input.action),
          placeholder: input.placeholder,
          options: input.options.slice(0, 25),
        },
      ],
    },
  ];
  if (input.more)
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: 'More tasks',
          custom_id: workCustomId({ id: input.receiptId, generation: 1 }, 'tasks-more'),
        },
      ],
    });
  return { kind: 'ready', card: workMessage(components) };
}
export async function workTaskPicker(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  let homeId = input.intent.linkId,
    cursor: string | null = null;
  if (input.intent.action === 'tasks-more') {
    const receipt = await ownedReceipt(db, input, context);
    if (!receipt) return setupReply(t('discordWork.unavailable'));
    const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
    homeId = workString(p.homeId) ?? undefined;
    cursor = workString(p.nextCursor);
  }
  const home = homeId ? await readProjectHome(db, context.scope, homeId) : null,
    actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!home || !actor) return setupReply(t('discordWork.unavailable'));
  const page = await choices(db, providers, { home, actor, cursor }, context);
  if (!page.tasks.length) return setupReply(t('discordWork.noTasks'));
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'tasks',
        homeId: home.id,
        tasks: page.tasks,
        nextCursor: page.nextCursor,
        canPlace: page.canPlace,
      },
    },
    context,
  );
  return choiceCard({
    receiptId: receipt.id,
    action: 'task',
    placeholder: t('discordWork.chooseTask'),
    options: page.tasks.map((task) => ({
      label: task.title.slice(0, 100),
      value: task.subject.pageId,
    })),
    more: Boolean(page.nextCursor),
  });
}
export async function workTaskSelection(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (!receipt) return setupReply(t('discordWork.unavailable'));
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown),
    tasks = Array.isArray(p.tasks) ? p.tasks : [];
  const task = notionObject(
      tasks.find((v) => notionObject(notionObject(v).subject).pageId === input.intent.value),
    ),
    subject = workSubject(task.subject);
  const home = await readProjectHome(db, context.scope, workString(p.homeId) ?? '');
  if (!subject || !home) return setupReply(t('discordWork.unavailable'));
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      homeId: home.id,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: 'comment',
    },
    context.clock(),
  );
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const existing = await findWorkSubject(db, context.scope, subject);
  if (existing)
    return setupReply(`https://discord.com/channels/${context.scope.guildId}/${existing.threadId}`);
  if (p.canPlace !== true) return setupReply(`https://www.notion.so/${subject.pageId}`);
  return prepareTaskLink(
    db,
    providers,
    { input, home, subject, title: workString(task.title, 200) ?? 'Task' },
    context,
  );
}
async function saveTargets(
  db: Db,
  providers: WorkProviders,
  input: { request: WorkPreviewInput; home: ProjectHome; message: WorkMessage },
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const actor = await resolveWorkActor(db, context.scope, input.request.discordUserId);
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const page = await choices(db, providers, { home: input.home, actor }, context);
  const targets: TaskChoice[] = page.canPlace
    ? [
        {
          title: input.home.title ?? 'Project',
          subject: {
            kind: 'project_plan',
            sourceId: input.home.projectSourceId,
            pageId: input.home.projectId,
          },
        },
        ...page.tasks.slice(0, 24),
      ]
    : page.tasks;
  if (!targets.length) return setupReply(t('discordWork.noTasks'));
  const receipt = await setupReceipt(
    db,
    {
      request: input.request,
      actor,
      payload: { intent: 'save-target', homeId: input.home.id, message: input.message, targets },
    },
    context,
  );
  return choiceCard({
    receiptId: receipt.id,
    action: 'save-target',
    placeholder: t('discordWork.chooseTask'),
    options: targets.map((target) => ({
      label: target.title.slice(0, 100),
      value: target.subject.pageId,
    })),
  });
}
export async function workSaveMessage(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const message = input.intent.message;
  if (message?.channelId !== input.channelId) return setupReply(t('discordWork.unavailable'));
  const conversations = await listWorkConversations(db, context.scope),
    homeIds = new Set(
      conversations.filter((c) => c.threadId === input.channelId).map((c) => c.homeId),
    );
  const homes = (await listProjectHomes(db, context.scope)).filter(
    (h) => h.destination.channelId === input.channelId || homeIds.has(h.id),
  );
  if (!homes.length) return setupReply(t('discordWork.noHome'));
  const [onlyHome] = homes;
  if (homes.length === 1 && onlyHome)
    return saveTargets(db, providers, { request: input, home: onlyHome, message }, context);
  const actor = await resolveWorkActor(db, context.scope, input.discordUserId);
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const receipt = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: { intent: 'save-project', homeIds: homes.map((h) => h.id), message },
    },
    context,
  );
  return choiceCard({
    receiptId: receipt.id,
    action: 'save-project',
    placeholder: t('discordWork.chooseProject'),
    options: homes.map((h) => ({ label: (h.title ?? 'Project').slice(0, 100), value: h.id })),
  });
}
export async function workSaveProject(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (!receipt) return setupReply(t('discordWork.unavailable'));
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown),
    ids = Array.isArray(p.homeIds) ? p.homeIds : [];
  if (!ids.includes(input.intent.value)) return setupReply(t('discordWork.unavailable'));
  const home = await readProjectHome(db, context.scope, input.intent.value ?? '');
  if (!home) return setupReply(t('discordWork.unavailable'));
  return saveTargets(
    db,
    providers,
    { request: input, home, message: p.message as WorkMessage },
    context,
  );
}
export async function workSaveSelection(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  const receipt = await ownedReceipt(db, input, context);
  if (!receipt) return setupReply(t('discordWork.unavailable'));
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown),
    targets = Array.isArray(p.targets) ? p.targets : [];
  const target = notionObject(
      targets.find((v) => notionObject(notionObject(v).subject).pageId === input.intent.value),
    ),
    subject = workSubject(target.subject),
    message = p.message as WorkMessage;
  const home = await readProjectHome(db, context.scope, workString(p.homeId) ?? '');
  if (!subject || !home) return setupReply(t('discordWork.unavailable'));
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject,
      homeId: home.id,
      taskSourceId: context.taskSourceId,
      discordUserId: input.discordUserId,
      action: 'comment',
    },
    context.clock(),
  );
  if (!actor) return setupReply(t('discordWork.unavailable'));
  const c = (await listWorkConversations(db, context.scope, home.id)).find(
    (v) => v.subject.pageId === subject.pageId,
  );
  const text = message.text || 'Discord attachments: open the source message to view them.';
  const preview = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: {
        intent: 'comment',
        subject,
        homeId: home.id,
        conversationId: c?.id,
        title: workString(target.title, 200) ?? 'Update',
        description: `Author: ${message.authorName}\nSubmitted by: <@${input.discordUserId}>\nhttps://discord.com/channels/${context.scope.guildId}/${message.channelId}/${message.id}\n\n${text.slice(0, 1800)}\n\n${t('discordWork.pointInTime')}`,
        originalAuthorId: message.authorId,
        message: { ...message, text },
        sourceKey: workMessageKey(subject.pageId, message),
      },
    },
    context,
  );
  return receiptCard(preview, context);
}
