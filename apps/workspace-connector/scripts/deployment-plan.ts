import { readFile } from 'node:fs/promises';
import { deploymentPlan, type DeploymentConfig } from '../src/deployment';
const file = process.argv[2];
if (!file) throw new Error('Pass the reviewed deployment JSON file');
const input = JSON.parse(await readFile(file, 'utf8')) as DeploymentConfig;
process.stdout.write(JSON.stringify(deploymentPlan(input), null, 2) + '\n');
