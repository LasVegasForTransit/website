import type { DiscordTaskMessage } from './notion-task-cards';

export function taskJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
export function taskNotice(content: string, status = 200): Response {
  return taskJson(
    { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } },
    status,
  );
}
export function taskPrivateMessage(message: DiscordTaskMessage): Response {
  return taskJson({ type: 4, data: { ...message, flags: message.flags | 64 } });
}
