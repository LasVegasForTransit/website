import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  claimTaskCommentRecovery,
  finishTaskCommentRecovery,
  failTaskCommentRecovery,
} from '@lasvegasfortransit/platform-storage/notion-task-recovery';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { findNotionTaskComment } from './notion-task-actions';
/** Recovery reads the provider; it cannot create a comment, change a deadline or send a DM. */
export async function processTaskCommentRecovery(
  db: Db,
  notion: NotionTaskClient,
  sourceId: string,
  clock: () => Date,
): Promise<{ kind: 'idle' | 'progress' }> {
  const claim = await claimTaskCommentRecovery(db, sourceId, clock());
  if (!claim) return { kind: 'idle' };
  try {
    const commentId = await findNotionTaskComment(notion, claim);
    await finishTaskCommentRecovery(db, claim, commentId, clock());
  } catch (error) {
    await failTaskCommentRecovery(
      db,
      claim,
      clock(),
      error instanceof NotionTaskApiError
        ? { retryAfterMs: error.retryAfterMs, terminal: !error.retryable }
        : {},
    );
  }
  return { kind: 'progress' };
}
