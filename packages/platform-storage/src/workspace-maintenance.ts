import { workspaceGroupsDue } from './workspace-group-due';
import type { Db } from './db';
import { providerPause } from './provider-backoff';
import { dueWorkspaceChannelEvents } from './workspace-channels';
import { claimWorkspaceScan } from './workspace-scans';
/** One purpose-specific heartbeat read/claim; it never acquires a group mutation lease. */
export async function workspaceMaintenance(db: Db, customerId: string, now: Date) {
  const pause = await providerPause(db, 'google_workspace', customerId, now);
  if (pause)
    return {
      events: [],
      groupsDue: false,
      scan: { kind: 'idle' as const },
      retryAfterMs: pause.retryAfterMs,
    };
  const events = await dueWorkspaceChannelEvents(db, customerId, now);
  const scan = (await claimWorkspaceScan(db, customerId, now)) ?? { kind: 'idle' as const };
  return {
    events,
    scan,
    groupsDue: await workspaceGroupsDue(db, customerId, now),
    retryAfterMs: 0,
  };
}
