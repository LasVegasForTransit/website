import assert from 'node:assert/strict';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { NotionTaskClient } from '../../src/notion-task-client';
import {
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './discord-work';

function parseBody(value: BodyInit | null | undefined): Record<string, unknown> {
  assert.ok(typeof value === 'string');
  return JSON.parse(value) as Record<string, unknown>;
}
function isArchiveRequest(method: string | undefined, body: Record<string, unknown>): boolean {
  return method === 'DELETE' || body.archived === true || body.in_trash === true;
}

export async function footerFixture() {
  const { db } = workFixture();
  const blocks: Record<string, unknown>[] = [];
  let nextId = 1;
  let loseAppendResponse = false;
  let loseArchiveResponse = false;
  let afterNextBlockRead: (() => void) | undefined;
  let afterNextAppend: (() => void) | undefined;
  let afterNextArchive: (() => void) | undefined;
  const runAfterArchive = () => {
    const callback = afterNextArchive;
    afterNextArchive = undefined;
    callback?.();
  };
  const childrenResponse = (url: URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = parseBody(init.body) as { children: Record<string, unknown>[] };
      const results = body.children.map((block) => ({
        ...block,
        id: String(nextId++).padStart(32, '0'),
        created_by: { id: 'bot' },
      }));
      blocks.push(...results);
      const appended = afterNextAppend;
      afterNextAppend = undefined;
      appended?.();
      if (loseAppendResponse) {
        loseAppendResponse = false;
        return Promise.reject(new Error('connection lost after append'));
      }
      return Promise.resolve(Response.json({ results, has_more: false, next_cursor: null }));
    }
    const start = Number(url.searchParams.get('start_cursor') ?? 0);
    const end = Math.min(start + 100, blocks.length);
    const response = Response.json({
      results: blocks.slice(start, end),
      has_more: end < blocks.length,
      next_cursor: end < blocks.length ? String(end) : null,
    });
    const callback = afterNextBlockRead;
    afterNextBlockRead = undefined;
    callback?.();
    return Promise.resolve(response);
  };
  const blockResponse = (url: URL, init?: RequestInit) => {
    const blockId = url.pathname.split('/').at(-1);
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return Promise.resolve(new Response(null, { status: 404 }));
    if (init?.method === 'GET') return Promise.resolve(Response.json(blocks[index]));
    const body = init?.body ? parseBody(init.body) : {};
    if (isArchiveRequest(init?.method, body)) {
      const [removed] = blocks.splice(index, 1);
      runAfterArchive();
      if (loseArchiveResponse) {
        loseArchiveResponse = false;
        return Promise.reject(new Error('connection lost after archive'));
      }
      return Promise.resolve(Response.json({ ...removed, in_trash: true }));
    }
    blocks[index] = { ...blocks[index], ...body };
    return Promise.resolve(Response.json(blocks[index]));
  };
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith('/users/me'))
      return Promise.resolve(Response.json({ id: 'bot', type: 'bot' }));
    if (url.pathname.includes('/pages/')) return Promise.resolve(Response.json({ id: taskId }));
    if (url.pathname.endsWith('/children')) return childrenResponse(url, init);
    return blockResponse(url, init);
  };
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'automatic' as const,
    state: 'active' as const,
    generation: 1,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  await saveProjectHome(db, home, 0, workNow);
  await saveWorkConversation(db, conversation, 0, workNow);
  return {
    db,
    blocks,
    conversation,
    client: (maxRequests?: number) =>
      new NotionTaskClient(
        'fixture-only',
        fetcher,
        maxRequests === undefined
          ? undefined
          : { maxRequests, deadline: Date.now() + 60_000, clock: () => new Date() },
      ),
    loseNextAppendResponse: () => {
      loseAppendResponse = true;
    },
    loseNextArchiveResponse: () => {
      loseArchiveResponse = true;
    },
    afterNextBlockRead: (callback: () => void) => {
      afterNextBlockRead = callback;
    },
    afterNextAppend: (callback: () => void) => {
      afterNextAppend = callback;
    },
    afterNextArchive: (callback: () => void) => {
      afterNextArchive = callback;
    },
    addOrganizerBlock: () => {
      const organizerBlock = {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        type: 'paragraph',
        created_by: { id: 'organizer' },
        paragraph: { rich_text: [{ type: 'text', text: { content: 'New planning details' } }] },
      };
      blocks.push(organizerBlock);
      return organizerBlock;
    },
  };
}
