import type { DiscordTaskMessage } from './notion-task-cards';
export type DiscordWorkBody =
  | { flags: number }
  | { topic: string }
  | { name: string }
  | { applied_tags: string[] }
  | { name: string; type: 0 | 4 | 15; parent_id?: string; topic?: string }
  | {
      name: string;
      auto_archive_duration: number;
      message?: DiscordTaskMessage;
      applied_tags?: string[];
    };
