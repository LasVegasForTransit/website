/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />
import type { StaffEnv, StaffContext } from './lib/context';
import type { AccessIdentity } from '@lasvegasfortransit/platform-integrations/access-identity';
declare global {
  interface Env extends StaffEnv {
    ASSETS: Fetcher;
  }
  namespace App {
    interface Locals {
      staff?: StaffContext;
      access?: AccessIdentity;
    }
  }
}
