import {
  workspaceConnectorRequest,
  type WorkspaceConnectorEnv,
} from '@lasvegasfortransit/platform-integrations/workspace-connector-api';
export const onRequest: PagesFunction<WorkspaceConnectorEnv> = async ({ env, request }) =>
  workspaceConnectorRequest(env, request);
