import { runWorkerPreview } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';

await runWorkerPreview(releaseConfiguration, process.argv.slice(2), [
  'LVBT_BEEHIIV_API_KEY',
  'LVBT_BEEHIIV_PUBLICATION_ID',
  'LVBT_MEMBERSHIP_INTAKE_SECRET',
  'LVBT_NOTION_API_KEY',
  'LVBT_NOTION_DATA_SOURCE_ID',
  'LVBT_PRESS_DATA_SOURCE_ID',
  'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
]);
