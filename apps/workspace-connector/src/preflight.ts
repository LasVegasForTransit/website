import { loadConfig } from './config';
loadConfig(process.env);
process.stdout.write(
  'Workspace connector configuration is valid. No provider resources were changed.\n',
);
