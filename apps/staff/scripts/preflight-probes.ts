import { type MetadataClient, array, object } from './preflight-api';
import { type releaseConfiguration, check, type Check } from './preflight-config';
import { inspectAccess } from './preflight-access';
import { value, type Bindings } from './preflight-workers';
import { inspectJobsExposure } from './preflight-exposure';
export function remoteProbes(
  client: MetadataClient,
  config: Awaited<ReturnType<typeof releaseConfiguration>>,
  staffBindings: Bindings,
) {
  const probes: { id: string; run: () => Promise<Check[]> }[] = [
    { id: 'jobs.exposure', run: () => inspectJobsExposure(client, config.jobsWorker) },
    {
      id: 'staff.domain',
      run: async () => [
        check(
          'staff.domain',
          (await client.list('/workers/domains')).some(
            (domain) =>
              domain.hostname === config.hostname && domain.service === config.staffWorker,
          ),
          'Attach the staff hostname to its selected Worker.',
        ),
      ],
    },
    {
      id: 'jobs.schedule',
      run: async () => [
        check(
          'jobs.schedule',
          array(
            object(
              await client.get(
                `/workers/scripts/${encodeURIComponent(config.jobsWorker)}/schedules`,
              ),
            ).schedules,
          ).some((schedule) => schedule.cron === '* * * * *'),
          'Jobs must run once a minute.',
        ),
      ],
    },
    {
      id: 'database.migrations',
      run: async () => {
        const applied = await client.migrations(config.databaseId);
        return [
          check(
            'database.migrations',
            config.migrations.every((name) => applied.includes(name)),
            'A maintainer must back up and apply every canonical migration before releasing applications.',
          ),
        ];
      },
    },
    {
      id: 'access.policy',
      run: () => inspectAccess(client, config.hostname, value(staffBindings, 'LVBT_ACCESS_AUD')),
    },
  ];
  return probes;
}
