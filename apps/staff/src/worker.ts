import { handle } from '@astrojs/cloudflare/handler';
import { guardStaffGateway } from './lib/gateway';
import type { StaffEnv } from './lib/context';
export default {
  async fetch(request: Request, env: StaffEnv & Env, context: ExecutionContext) {
    return await guardStaffGateway(request, env, {
      next: async () => await handle(request, env, context),
    });
  },
};
