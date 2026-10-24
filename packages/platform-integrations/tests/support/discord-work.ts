import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { NotionTaskClient } from '../../src/notion-task-client';
import { taskPolicy } from './task-checkins';
export const workScope = {
  environment: 'preview' as const,
  guildId: '222222222222222222',
  workspaceId: 'workspace',
};
export const sourceId = '10000000-0000-4000-8000-000000000001';
export const taskId = '10000000-0000-4000-8000-000000000002';
export const projectSourceId = taskPolicy.projectsSourceId;
export const projectId = '10000000-0000-4000-8000-000000000004';
export const discordUserId = '111111111111111111';
export const workNow = new Date('2026-10-22T12:00:00Z');
export function workFixture() {
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('guest',?,?)")
    .run(workNow.toISOString(), workNow.toISOString());
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('identity','guest','discord',?,?,'self_linked',?,?)",
    )
    .run(discordUserId, workNow.toISOString(), workNow.toISOString(), workNow.toISOString());
  db.raw
    .prepare(
      "INSERT INTO task_checkin_sources(id,workspace_id,revision,enabled,policy_json,updated_at) VALUES(?,'workspace',1,0,?,?)",
    )
    .run(sourceId, JSON.stringify(taskPolicy), workNow.toISOString());
  db.raw
    .prepare(
      "INSERT INTO task_checkin_mappings(workspace_id,notion_user_id,person_id,confirmed_at) VALUES('workspace','notion-guest','guest',?)",
    )
    .run(workNow.toISOString());
  const task = {
    object: 'page',
    id: taskId,
    parent: { data_source_id: sourceId },
    last_edited_time: workNow.toISOString(),
    url: `https://www.notion.so/${taskId}`,
    archived: false,
    properties: {
      'Task name': { type: 'title', title: [{ plain_text: 'Prepare agenda' }] },
      Assignee: { type: 'people', people: [{ id: 'notion-guest' }] },
      Project: { type: 'relation', relation: [{ id: projectId }], has_more: false },
      Status: { type: 'status', status: { name: 'Not started' } },
      'Due date': { type: 'date', date: { start: '2026-10-23' } },
      Description: { type: 'rich_text', rich_text: [] },
    },
  };
  const project = {
    object: 'page',
    id: projectId,
    parent: { data_source_id: projectSourceId },
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Project' }] },
      Lead: { type: 'people', people: [] },
    },
  };
  const notion = new NotionTaskClient('fixture-only', (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith(`/pages/${taskId}`)) return Promise.resolve(Response.json(task));
    if (url.endsWith(`/pages/${projectId}`)) return Promise.resolve(Response.json(project));
    return Promise.resolve(Response.json({ message: 'not found' }, { status: 404 }));
  });
  return { db, notion, task, project };
}
