import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import type { WorkConversation } from './discord-work-types';

export interface FooterWriteOptions {
  now: Date;
  beforeWrite?: (() => Promise<boolean>) | undefined;
}

export async function canWriteFooter(
  db: Db,
  input: WorkConversation,
  beforeWrite?: () => Promise<boolean>,
): Promise<boolean> {
  if (beforeWrite && !(await beforeWrite())) return false;
  const current = await readWorkConversation(db, input.scope, input.id);
  const home = current ? await readProjectHome(db, input.scope, current.homeId) : null;
  return (
    current?.state === 'active' &&
    current.generation === input.generation &&
    home?.state === 'active'
  );
}
