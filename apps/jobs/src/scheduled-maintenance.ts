import { runMeteredJob } from './job-database';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';

export class StaffMaintenance extends WorkerEntrypoint<Env> {
  async run(scheduledTime: number) {
    return await runMeteredJob(this.env.PLATFORM_DB, 'StaffMaintenance', async (budget) => {
      const result = await runMaintenance(budget.db, {
        now: new Date(scheduledTime),
        category: 'records',
      });
      return { ...result, queries: budget.queries };
    });
  }
}
export class ProfileMaintenance extends WorkerEntrypoint<Env> {
  async run(scheduledTime: number) {
    return await runMeteredJob(this.env.PLATFORM_DB, 'ProfileMaintenance', async (budget) => {
      const result = await runMaintenance(budget.db, {
        now: new Date(scheduledTime),
        category: 'profiles',
      });
      return { ...result, queries: budget.queries };
    });
  }
}
export class InactiveProfileMaintenance extends WorkerEntrypoint<Env> {
  async run(scheduledTime: number) {
    return await runMeteredJob(
      this.env.PLATFORM_DB,
      'InactiveProfileMaintenance',
      async (budget) => {
        const result = await runMaintenance(budget.db, {
          now: new Date(scheduledTime),
          category: 'inactive',
        });
        return { ...result, queries: budget.queries };
      },
    );
  }
}
export class ProviderCompletion extends WorkerEntrypoint<Env> {
  async run(scheduledTime: number) {
    return await runMeteredJob(this.env.PLATFORM_DB, 'ProviderCompletion', async (budget) => {
      const completed = await completeProviderOperations(budget.db, {
        now: new Date(scheduledTime),
      });
      return { completed, queries: budget.queries };
    });
  }
}
