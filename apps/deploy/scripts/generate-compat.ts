import { fileURLToPath } from 'node:url';
import {
  generateTypedWorkerCompatibility,
  readReleaseConfiguration,
} from '@lasvegasfortransit/web-platform/release';

const source = fileURLToPath(new URL('../', import.meta.url));
const destination = fileURLToPath(new URL('../../site/', import.meta.url));
const config = await readReleaseConfiguration(fileURLToPath(new URL('../../../', import.meta.url)));
await generateTypedWorkerCompatibility(source, destination, config);
