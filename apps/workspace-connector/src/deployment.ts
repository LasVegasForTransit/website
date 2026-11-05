import { validateConfig, type ConnectorConfig } from './config';
export interface DeploymentConfig {
  project: string;
  region: string;
  service: string;
  image: string;
  runtimeSubject: string;
  schedulerAccount: string;
  connector: ConnectorConfig;
}
export function deploymentPlan(input: DeploymentConfig) {
  const c = validateConfig(input.connector),
    suffix = c.environment === 'preview' ? '-preview' : '';
  const service = `lvbt-workspace${suffix}`,
    runtime = `${service}@lvbt-core.iam.gserviceaccount.com`;
  const scheduler = `lvbt-workspace-tick${suffix}@lvbt-core.iam.gserviceaccount.com`;
  if (
    input.project !== 'lvbt-core' ||
    input.region !== 'us-central1' ||
    input.service !== service ||
    c.serviceAccount !== runtime ||
    input.schedulerAccount !== scheduler ||
    !/^\d{10,30}$/.test(input.runtimeSubject) ||
    input.runtimeSubject === c.schedulerSubject ||
    !/^us-central1-docker\.pkg\.dev\/lvbt-core\/workspace-connectors\/[a-z-]+@sha256:[a-f0-9]{64}$/.test(
      input.image,
    )
  )
    throw new Error('Deployment identities or immutable image are not isolated');
  return {
    environment: c.environment,
    project: input.project,
    region: input.region,
    cloudflare: {
      LVBT_WORKSPACE_ONBOARDING_ENABLED: 'false',
      LVBT_WORKSPACE_CONNECTOR_SUBJECT: input.runtimeSubject,
      LVBT_WORKSPACE_CONNECTOR_AUDIENCE: c.siteAudience,
      LVBT_WORKSPACE_ONBOARDING_CONFIG: JSON.stringify(c),
    },
    workspace: {
      clientId: input.runtimeSubject,
      delegatedAdmin: c.delegatedAdmin,
      scopes: [
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.member',
      ],
    },
    commands: commands(input, { service, runtime, scheduler }),
    prerequisites: [
      `Create or verify the separate runtime ${runtime} and Scheduler ${scheduler}; read their actual unique IDs into this configuration.`,
      'Create or verify the workspace-connectors Docker repository and build/push the reviewed image before selecting its immutable digest.',
      'Prepare reviewed-runtime-env.yaml with WORKSPACE_CONNECTOR_CONFIG as a JSON string; verify origin equals the actual Cloud Run service URL.',
      'Review the complete human/service Directory inventory, OU IDs, group ownership and explicit per-ID exceptions.',
      'Verify the restricted delegated administrator and exact domain-wide delegation client/scopes in Workspace Admin.',
      'Apply additive D1 migrations and compatible site/staff releases with onboarding disabled before activating the connector.',
    ],
  };
}

function commands(
  input: DeploymentConfig,
  names: { service: string; runtime: string; scheduler: string },
) {
  const { service, runtime, scheduler } = names;
  const flags = ['--account=willie@lasvegasfortransit.org', '--project=lvbt-core'];
  return [
    [
      'gcloud',
      'services',
      'enable',
      'run.googleapis.com',
      'iamcredentials.googleapis.com',
      'cloudscheduler.googleapis.com',
      'artifactregistry.googleapis.com',
      ...flags,
    ],
    [
      'gcloud',
      'iam',
      'roles',
      'create',
      'workspaceJwtSigner',
      '--permissions=iam.serviceAccounts.signJwt',
      '--stage=GA',
      '--title=Workspace connector signing',
      ...flags,
    ],
    [
      'gcloud',
      'iam',
      'service-accounts',
      'add-iam-policy-binding',
      runtime,
      `--member=serviceAccount:${runtime}`,
      '--role=projects/lvbt-core/roles/workspaceJwtSigner',
      ...flags,
    ],
    runCommand(input, { service, runtime }),
    schedulerCommand(input, { service, scheduler }),
  ];
}

function runCommand(input: DeploymentConfig, names: { service: string; runtime: string }) {
  const { service, runtime } = names;
  const flags = ['--account=willie@lasvegasfortransit.org', '--project=lvbt-core'];
  return [
    'gcloud',
    'run',
    'deploy',
    service,
    `--image=${input.image}`,
    `--service-account=${runtime}`,
    '--region=us-central1',
    '--allow-unauthenticated',
    '--min-instances=0',
    '--max-instances=1',
    '--concurrency=1',
    '--cpu=1',
    '--memory=512Mi',
    '--timeout=60',
    '--cpu-throttling',
    '--env-vars-file=reviewed-runtime-env.yaml',
    ...flags,
  ];
}
function schedulerCommand(input: DeploymentConfig, names: { service: string; scheduler: string }) {
  const { service, scheduler } = names,
    c = input.connector;
  const flags = ['--account=willie@lasvegasfortransit.org', '--project=lvbt-core'];
  return [
    'gcloud',
    'scheduler',
    'jobs',
    'create',
    'http',
    service,
    '--location=us-central1',
    '--schedule=* * * * *',
    `--uri=${c.origin}/run`,
    '--http-method=POST',
    `--oidc-service-account-email=${scheduler}`,
    `--oidc-token-audience=${c.origin}`,
    '--attempt-deadline=60s',
    '--max-retry-attempts=0',
    ...flags,
  ];
}
