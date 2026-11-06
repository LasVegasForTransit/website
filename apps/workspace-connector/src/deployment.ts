import { validateConfig, type ConnectorConfig } from './config';
export interface DeploymentConfig {
  project: string;
  region: string;
  service: string;
  image: string;
  runtimeSubject: string;
  schedulerAccount: string;
  configSecretVersion: string;
  connector: ConnectorConfig;
}
export function deploymentPlan(input: DeploymentConfig) {
  const c = validateConfig(input.connector),
    suffix = c.environment === 'preview' ? '-preview' : '',
    configSecret = `workspace-connector-config-${c.environment}`;
  const service = `lvbt-workspace${suffix}`,
    runtime = `${service}@lvbt-core.iam.gserviceaccount.com`,
    deployerName =
      c.environment === 'preview' ? 'lvbt-ws-deployer-preview' : 'lvbt-workspace-deployer',
    deployer = `${deployerName}@lvbt-core.iam.gserviceaccount.com`;
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
    ) ||
    !/^[1-9][0-9]*$/.test(input.configSecretVersion)
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
    commands: commands(input, { service, runtime, scheduler, deployer }),
    prerequisites: [
      `Create or verify the separate runtime ${runtime} and Scheduler ${scheduler}; read their actual unique IDs into this configuration.`,
      `Create or verify the separate deployer ${deployer} and bind only the GitHub environment identity to it through Workload Identity Federation.`,
      'Create or verify the workspace-connectors Docker repository and build/push the reviewed image before selecting its immutable digest.',
      `Create Secret Manager secret ${configSecret}, add the reviewed connector JSON as a version, and grant Secret Accessor only to ${runtime} and ${deployer}.`,
      `Select the reviewed numeric version ${input.configSecretVersion}; verify its origin equals the actual Cloud Run service URL.`,
      'Review the complete human/service Directory inventory, OU IDs, group ownership and explicit per-ID exceptions.',
      'Verify the restricted delegated administrator and exact domain-wide delegation client/scopes in Workspace Admin.',
      'Apply additive D1 migrations and compatible site/staff releases with onboarding disabled before activating the connector.',
    ],
  };
}

function commands(
  input: DeploymentConfig,
  names: { service: string; runtime: string; scheduler: string; deployer: string },
) {
  const { service, runtime, scheduler, deployer } = names;
  const flags = ['--account=willie@lasvegasfortransit.org', '--project=lvbt-core'];
  return [
    [
      'gcloud',
      'services',
      'enable',
      'admin.googleapis.com',
      'run.googleapis.com',
      'iamcredentials.googleapis.com',
      'cloudscheduler.googleapis.com',
      'artifactregistry.googleapis.com',
      'secretmanager.googleapis.com',
      ...flags,
    ],
    ...deploymentAccessCommands(input.connector.environment, {
      service,
      runtime,
      deployer,
      flags,
    }),
    [
      'gcloud',
      'secrets',
      'add-iam-policy-binding',
      `workspace-connector-config-${input.connector.environment}`,
      `--member=serviceAccount:${runtime}`,
      '--role=roles/secretmanager.secretAccessor',
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
    schedulerPauseCommand(service),
  ];
}

function deploymentAccessCommands(
  environment: ConnectorConfig['environment'],
  names: { service: string; runtime: string; deployer: string; flags: string[] },
) {
  const { service, runtime, deployer, flags } = names,
    secret = `workspace-connector-config-${environment}`;
  return [
    [
      'gcloud',
      'secrets',
      'add-iam-policy-binding',
      secret,
      `--member=serviceAccount:${deployer}`,
      '--role=roles/secretmanager.secretAccessor',
      ...flags,
    ],
    [
      'gcloud',
      'artifacts',
      'repositories',
      'add-iam-policy-binding',
      'workspace-connectors',
      '--location=us-central1',
      `--member=serviceAccount:${deployer}`,
      '--role=roles/artifactregistry.writer',
      ...flags,
    ],
    [
      'gcloud',
      'run',
      'services',
      'add-iam-policy-binding',
      service,
      '--region=us-central1',
      `--member=serviceAccount:${deployer}`,
      '--role=roles/run.developer',
      ...flags,
    ],
    [
      'gcloud',
      'iam',
      'service-accounts',
      'add-iam-policy-binding',
      runtime,
      `--member=serviceAccount:${deployer}`,
      '--role=roles/iam.serviceAccountUser',
      ...flags,
    ],
  ];
}

function schedulerPauseCommand(service: string) {
  return [
    'gcloud',
    'scheduler',
    'jobs',
    'pause',
    service,
    '--location=us-central1',
    '--account=willie@lasvegasfortransit.org',
    '--project=lvbt-core',
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
    `--set-secrets=WORKSPACE_CONNECTOR_CONFIG=workspace-connector-config-${input.connector.environment}:${input.configSecretVersion}`,
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
