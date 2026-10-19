import { runMeteredJob, idleDatabaseJob } from './job-database';
import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import { pollBeehiivRoster } from '@lasvegasfortransit/platform-integrations/beehiiv-poll';
import { reconcileBeehiivPerson } from '@lasvegasfortransit/platform-integrations/beehiiv-sync';
import { processNewsletterSourceEvents } from '@lasvegasfortransit/platform-integrations/newsletter-source-processor';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { pendingNewsletterPeople } from '@lasvegasfortransit/platform-storage/newsletter-sync-store';
import { newsletterPause } from '@lasvegasfortransit/platform-storage/newsletter-work';
import { QueryBudgetExceeded } from '@lasvegasfortransit/platform-storage/query-budget';

export class NewsletterAccount extends WorkerEntrypoint<Env & BeehiivRuntimeEnv> {
  async run() {
    const runtime = beehiivRuntime(this.env);
    if (!runtime) return idleDatabaseJob({ kind: 'idle' as const, queries: 0, paused: false });
    return await runMeteredJob(this.env.PLATFORM_DB, 'NewsletterAccount', async (budget) => {
      try {
        const [personId] = await pendingNewsletterPeople(budget.db, new Date(), 1);
        if (!personId) return { kind: 'idle' as const, queries: budget.queries, paused: false };
        const result = await reconcileBeehiivPerson(budget.db, personId, runtime);
        const paused =
          result.kind === 'retry' &&
          (await newsletterPause(budget.db, runtime.configuration.publicationId, new Date())) > 0;
        return { ...result, queries: budget.queries, paused };
      } catch (error) {
        return {
          kind: 'failed' as const,
          queries: budget.queries,
          paused: false,
          failure: error instanceof QueryBudgetExceeded ? 'query_budget' : 'storage_error',
        };
      }
    });
  }
}

export class NewsletterScan extends WorkerEntrypoint<Env & BeehiivRuntimeEnv> {
  async run() {
    const runtime = beehiivRuntime(this.env);
    if (!runtime) return idleDatabaseJob({ ready: false, kind: 'idle' as const, queries: 0 });
    return await runMeteredJob(this.env.PLATFORM_DB, 'NewsletterScan', async (budget) => {
      if (await newsletterPause(budget.db, runtime.configuration.publicationId, new Date()))
        return { ready: true, kind: 'paused' as const, queries: budget.queries };
      const result = await pollBeehiivRoster(budget.db, runtime.configuration);
      return { ...result, ready: true, queries: budget.queries };
    });
  }
}

export class NewsletterIncoming extends WorkerEntrypoint<Env & BeehiivRuntimeEnv> {
  async run() {
    const runtime = beehiivRuntime(this.env);
    if (!runtime) return idleDatabaseJob({ kind: 'idle' as const, queries: 0, more: false });
    return await runMeteredJob(this.env.PLATFORM_DB, 'NewsletterIncoming', async (budget) => {
      try {
        const result = await processNewsletterSourceEvents(budget.db, {
          publicationId: runtime.configuration.publicationId,
          intentKey: runtime.intentKey,
          now: new Date(),
        });
        return { ...result, queries: budget.queries };
      } catch (error) {
        return {
          kind: 'failed' as const,
          queries: budget.queries,
          more: false,
          failure: error instanceof QueryBudgetExceeded ? 'query_budget' : 'storage_error',
        };
      }
    });
  }
}

export class NewsletterPollingChoices extends WorkerEntrypoint<Env & BeehiivRuntimeEnv> {
  async run() {
    const env: BeehiivRuntimeEnv = this.env;
    const runtime = beehiivRuntime(env),
      policy = env.LVBT_BEEHIIV_CONFLICT_POLICY;
    if (!runtime || (policy !== 'keep_unsubscribed' && policy !== 'staff_review'))
      return idleDatabaseJob({ kind: 'idle' as const, queries: 0, more: false });
    return await runMeteredJob(this.env.PLATFORM_DB, 'NewsletterPollingChoices', async (budget) => {
      try {
        const result = await new PersonService(budget.db).processNewsletterPollChoices({
          publicationId: runtime.configuration.publicationId,
          policy,
          now: new Date(),
        });
        return { ...result, queries: budget.queries };
      } catch (error) {
        return {
          kind: 'failed' as const,
          queries: budget.queries,
          more: false,
          failure: error instanceof QueryBudgetExceeded ? 'query_budget' : 'storage_error',
        };
      }
    });
  }
}
