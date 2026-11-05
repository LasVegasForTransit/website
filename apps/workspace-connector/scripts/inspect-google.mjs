import { execFileSync } from 'node:child_process';
// Read-only commands deliberately pin LVBT rather than the operator's active gcloud profile.
const flags = [
  '--account=willie@lasvegasfortransit.org',
  '--project=lvbt-core',
  '--format=json',
  '--quiet',
];
const checks = {
  billing: ['billing', 'projects', 'describe', 'lvbt-core'],
  apis: ['services', 'list', '--enabled'],
  identities: ['iam', 'service-accounts', 'list'],
  services: ['run', 'services', 'list', '--region=us-central1'],
  scheduler: ['scheduler', 'jobs', 'list', '--location=us-central1'],
};
const report = { project: 'lvbt-core', checks: {} };
for (const [name, args] of Object.entries(checks)) {
  try {
    report.checks[name] = {
      available: true,
      value: JSON.parse(
        execFileSync('gcloud', [...args, ...flags], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ),
    };
  } catch {
    report.checks[name] = {
      available: false,
      reason:
        'Read unavailable; verify login, permission and API enablement. No enablement attempted.',
    };
  }
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
