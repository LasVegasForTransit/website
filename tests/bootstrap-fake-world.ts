/* eslint-disable max-lines -- one composite fake runtime for the end-to-end bootstrap tests. */
// A pretend GitHub, Cloudflare and local toolchain for running the whole
// bootstrap in a test. It answers the commands and API calls the bootstrap
// makes, keeps what they change, and records every call that changes
// something, so a test can check that a second run changes nothing.
//
// Every value here is a fake. Nothing reaches a real service.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  BootstrapRuntime,
  CommandOptions,
  PromptValidator,
  SelectPrompt,
} from '../scripts/bootstrap/lib/runtime.js';
import type { CommandResult } from '../scripts/bootstrap/lib/types.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
export const FAKE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const PAGES_SUBDOMAIN = 'lvbt-website-x1y.pages.dev';
const LIVE_IP = '192.0.2.10';

export type PromptKind = 'confirm' | 'text' | 'password' | 'select';

export interface PromptRecord {
  kind: PromptKind;
  id: string;
  message: string;
}

/** An answer by prompt id. Unanswered prompts take their default. */
export type Answer = string | boolean;

interface PagesProjectState {
  production: { id: string; url: string; created_on: string } | null;
  domains: Set<string>;
}

interface DnsRecordState {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

const ok = (stdout = ''): CommandResult => ({ ok: true, stdout, stderr: '' });
const fail = (stderr: string): CommandResult => ({ ok: false, stdout: '', stderr });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cfResult(result: unknown): Response {
  return json({ success: true, errors: [], messages: [], result });
}

function cfError(status: number, code: number, message: string): Response {
  return json({ success: false, errors: [{ code, message }], messages: [], result: null }, status);
}

/** A fake value that passes each secret's own check. */
export function fakeValueFor(name: string): string {
  if (name === 'LVBT_RESEND_API_KEY') return 're_fake_0123456789abcdefghij';
  if (name === 'LVBT_BEEHIIV_PUBLICATION_ID') return 'pub_00000000-fake-0000-0000-000000000000';
  if (name === 'LVBT_GOOGLE_OAUTH_CLIENT_ID') return 'fake-client.apps.googleusercontent.com';
  if (name === 'LVBT_ACCESS_TEAM_DOMAIN') return 'lvbt-test.cloudflareaccess.com';
  if (name === 'LVBT_GOOGLE_SERVICE_ACCOUNT_KEY') return '{"type":"service_account","fake":true}';
  if (name === 'LVBT_GOOGLE_ADMIN_SUBJECT') return 'root@lasvegasfortransit.org';
  if (name === 'CLOUDFLARE_API_TOKEN') return 'fake_dns_token_0123456789abcdef';
  if (name.startsWith('PUBLIC_')) return `https://example.test/${name.toLowerCase()}`;
  return `fake-${name.toLowerCase()}-0123456789abcdef0123456789abcdef`;
}

export class FakeWorld {
  // ── Remote and local state ────────────────────────────────────────────────
  readonly repos = new Set<string>();
  origin: string | null = null;
  readonly projects = new Map<string, PagesProjectState>();
  workerDeployed = false;
  readonly workerDomains = new Map<string, string>();
  readonly workerSecrets = new Set<string>();
  readonly pagesSecrets = new Set<string>();
  readonly githubSecrets = new Set<string>();
  readonly dns: DnsRecordState[] = [];
  readonly zone = { id: 'zone-fake-1', name: 'lasvegasfortransit.org' };
  /** Hosts Pages still reports as waiting for their certificate. */
  readonly pendingHosts = new Set<string>();

  // ── What happened during the current run ──────────────────────────────────
  commands: string[] = [];
  /** Every command or API call that changed something. */
  mutations: string[] = [];
  prompts: PromptRecord[] = [];
  /** Every value typed into a hidden prompt or written as a secret. */
  private readonly hidden = new Set<string>();
  /** Every value typed into a visible prompt. */
  private readonly visible = new Set<string>();
  /** Commands (by prefix) that fail the next time they run. */
  readonly failOnce = new Set<string>();

  constructor(
    private readonly projectRoot: string,
    private readonly home: string,
    public answers: Record<string, Answer> = {},
  ) {}

  beginRun(answers: Record<string, Answer> = this.answers): void {
    this.answers = answers;
    this.commands = [];
    this.mutations = [];
    this.prompts = [];
  }

  /** Secret values the bootstrap handled. None of them may ever be printed. */
  secretValues(): string[] {
    return [...this.hidden].filter((value) => !this.visible.has(value));
  }

  /** Names the hidden (password) prompts asked for in the current run. */
  secretPrompts(): string[] {
    return this.prompts.filter((p) => p.kind === 'password').map((p) => p.id);
  }

  /** Names every value prompt, hidden or visible, asked for in the current run. */
  valuePrompts(): string[] {
    return this.prompts.filter((p) => p.kind === 'password' || p.kind === 'text').map((p) => p.id);
  }

  /** Every way the current run asked for `id`. */
  promptKinds(id: string): PromptKind[] {
    return this.prompts.filter((p) => p.id === id).map((p) => p.kind);
  }

  runtime(): BootstrapRuntime {
    return {
      run: (command, options) => this.run(command, options),
      runInteractive: (command) => {
        this.commands.push(command);
        throw new Error(`Unexpected interactive command: ${command}`);
      },
      runStreaming: (command, options) => Promise.resolve(this.run(command, options)),
      runWithInput: (command, input) => this.runWithInput(command, input),
      fetch: (input, init) => this.fetch(input, init),
      prompts: {
        confirm: (p) => Promise.resolve(this.answer('confirm', p.id, p.message, p.initialValue)),
        text: (p) => Promise.resolve(this.answerText('text', p, p.defaultValue ?? '')),
        password: (p) => Promise.resolve(this.answerText('password', p, '')),
        select: <T extends string>(p: SelectPrompt<T>) => {
          const fallback = p.initialValue ?? p.options.at(0)?.value;
          if (fallback === undefined) throw new Error(`Select ${p.id} has no options`);
          const chosen = this.answer('select', p.id, p.message, fallback);
          const match = p.options.find((o) => o.value === chosen);
          if (!match) throw new Error(`Select ${p.id} has no option ${chosen}`);
          return Promise.resolve(match.value);
        },
      },
      resolve4: (host) => Promise.resolve(this.hasCname(host) ? [LIVE_IP] : []),
      resolveNs: () => Promise.resolve(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']),
      openUrl: () => true,
      wranglerOAuthToken: () => 'fake-wrangler-oauth-token',
      isInteractive: () => true,
      sleep: () => Promise.resolve(),
    };
  }

  // ── Prompts ───────────────────────────────────────────────────────────────

  private answer<T extends Answer>(kind: PromptKind, id: string, message: string, fallback: T): T {
    this.prompts.push({ kind, id, message });
    if (!Object.hasOwn(this.answers, id)) return fallback;
    const scripted = this.answers[id];
    if (typeof scripted !== typeof fallback) {
      throw new Error(`Answer for ${id} should be a ${typeof fallback}`);
    }
    return scripted as T;
  }

  private answerText(
    kind: 'text' | 'password',
    { id, message, validate }: { id: string; message: string; validate?: PromptValidator },
    fallback: string,
  ): string {
    const value = this.answer(kind, id, message, fallback);
    const problem = validate?.(value);
    if (problem) throw new Error(`Fake answer for ${id} is invalid: ${problem}`);
    if (value) (kind === 'password' ? this.hidden : this.visible).add(value);
    return value;
  }

  // ── Shell commands ────────────────────────────────────────────────────────

  private mutate(what: string): void {
    this.mutations.push(what);
  }

  private run(command: string, options: CommandOptions = {}): CommandResult {
    this.commands.push(command);
    for (const prefix of this.failOnce) {
      if (command.startsWith(prefix)) {
        this.failOnce.delete(prefix);
        return fail(`fake failure: ${prefix}`);
      }
    }
    return (
      this.toolchain(command) ??
      this.git(command, options) ??
      this.github(command) ??
      this.cloud(command)
    );
  }

  private toolchain(command: string): CommandResult | null {
    if (command.startsWith('command -v ')) return ok(`/usr/local/bin/${command.slice(11)}`);
    if (command === 'node --version') return ok('v24.20.0');
    if (command === 'pnpm --version') return ok('11.25.0');
    if (command === 'git lfs version') return ok('git-lfs/3.7.0');
    if (/^[a-z-]+ -?-?version$/.test(command)) return ok('1.0.0');
    if (command === 'gh auth status 2>/dev/null' || command === 'gh auth status') {
      return ok("Logged in to github.com\n  - Token scopes: 'repo', 'read:packages'");
    }
    if (command === "wrangler whoami 2>/dev/null | grep -q '@'") return ok();
    if (command === 'pnpm install --frozen-lockfile') return ok();
    if (command.startsWith('pnpm exec tsx scripts/audit/')) return ok();
    if (command === 'pnpm test:install') {
      mkdirSync(path.join(this.home, '.cache', 'ms-playwright', 'chromium-1000'), {
        recursive: true,
      });
      return ok();
    }
    if (command === 'pnpm build') {
      mkdirSync(path.join(this.projectRoot, 'dist'), { recursive: true });
      writeFileSync(path.join(this.projectRoot, 'dist', 'index.html'), '<!doctype html>');
      return ok();
    }
    return null;
  }

  private git(command: string, options: CommandOptions): CommandResult | null {
    if (command === 'git remote get-url origin') {
      return this.origin ? ok(this.origin) : fail('error: No such remote');
    }
    if (command === 'git rev-parse --verify HEAD') return ok('f'.repeat(40));
    if (command === 'git rev-parse --abbrev-ref HEAD') return ok('main');
    if (command === 'git init -b main') {
      this.mutate(command);
      mkdirSync(path.join(options.cwd ?? this.projectRoot, '.git'), { recursive: true });
      return ok();
    }
    const add = /^git remote (?:add|set-url) origin '(.+)'$/.exec(command);
    if (add?.[1]) {
      this.mutate(command);
      this.origin = add[1];
      return ok();
    }
    if (command.startsWith('git push ')) {
      this.mutate(command);
      return ok();
    }
    return null;
  }

  private github(command: string): CommandResult | null {
    const view = /^gh repo view '([^']+)' --json (\S+)/.exec(command);
    if (view?.[1]) {
      const name = view[1];
      if (!this.repos.has(name)) return fail(`GraphQL: Could not resolve to a Repository`);
      if (view[2] === 'url') return ok(`https://github.com/${name}`);
      return ok(
        JSON.stringify({
          url: `https://github.com/${name}`,
          sshUrl: `git@github.com:${name}.git`,
          nameWithOwner: name,
        }),
      );
    }
    const create = /^gh repo create '([^']+)'/.exec(command);
    if (create?.[1]) {
      this.mutate(`gh repo create ${create[1]}`);
      this.repos.add(create[1]);
      return ok();
    }
    return null;
  }

  private cloud(command: string): CommandResult {
    const workerResult = this.workerCommand(command);
    if (workerResult) return workerResult;
    if (command === 'wrangler whoami') {
      return ok(
        [
          '┌──────────────┬──────────────────────────────────┐',
          '│ Account Name │ Account ID                       │',
          '├──────────────┼──────────────────────────────────┤',
          `│ LVBT (fake)  │ ${FAKE_ACCOUNT_ID} │`,
          '└──────────────┴──────────────────────────────────┘',
        ].join('\n'),
      );
    }
    const create = /^wrangler pages project create '([^']+)'/.exec(command);
    if (create?.[1]) {
      if (this.projects.has(create[1]))
        return fail('A project with this name already exists. [code: 8000002]');
      this.mutate(`pages project create ${create[1]}`);
      this.projects.set(create[1], { production: null, domains: new Set() });
      return ok();
    }
    const deploy = /^wrangler pages deploy \.\/dist --project-name='([^']+)'/.exec(command);
    if (deploy?.[1]) {
      const project = this.projects.get(deploy[1]);
      if (!project) return fail('Project not found. [code: 8000007]');
      this.mutate(`pages deploy ${deploy[1]}`);
      project.production = {
        id: 'deployment-fake',
        url: `https://abc123.${PAGES_SUBDOMAIN}`,
        created_on: '2026-09-23T00:00:00Z',
      };
      return ok(`Deployment complete! https://abc123.${PAGES_SUBDOMAIN}`);
    }
    if (command === 'pnpm -s exec wrangler secret list --name lvbt-website --format json') {
      return ok(
        JSON.stringify([...this.workerSecrets].map((name) => ({ name, type: 'secret_text' }))),
      );
    }
    if (command === 'pnpm -s exec wrangler pages secret list --project-name lvbt-website') {
      if (!this.projects.has('lvbt-website')) return fail('Project not found. [code: 8000007]');
      const lines = [...this.pagesSecrets].map((name) => `  - ${name}: Value Encrypted`);
      return ok(
        `The "production" environment of your Pages project has access to:\n${lines.join('\n')}`,
      );
    }
    if (command === 'gh secret list --env worker-candidate --json name') {
      return ok(JSON.stringify([...this.githubSecrets].map((name) => ({ name }))));
    }
    throw new Error(`Unexpected command: ${command}`);
  }

  private workerCommand(command: string): CommandResult | null {
    if (command === 'wrangler deployments list --name lvbt-website --json') {
      return this.workerDeployed
        ? ok('[{"id":"worker-deployment-fake"}]')
        : fail('Worker not found');
    }
    if (command === 'pnpm worker:deploy') {
      this.mutate('worker deploy lvbt-website');
      this.workerDeployed = true;
      return ok('Worker deployed');
    }
    return null;
  }

  private runWithInput(command: string, input: string): CommandResult {
    this.commands.push(command);
    if (!input) throw new Error(`Empty secret written by: ${command}`);
    this.hidden.add(input);
    const worker = /^pnpm -s exec wrangler versions secret put (\w+) --name lvbt-website /.exec(
      command,
    );
    if (worker?.[1]) {
      this.mutate(`worker secret ${worker[1]}`);
      this.workerSecrets.add(worker[1]);
      return ok();
    }
    const pages = /^pnpm -s exec wrangler pages secret put (\w+) --project-name lvbt-website$/.exec(
      command,
    );
    if (pages?.[1]) {
      this.mutate(`pages secret ${pages[1]}`);
      this.pagesSecrets.add(pages[1]);
      return ok();
    }
    const github = /^gh secret set (\w+) --env worker-candidate$/.exec(command);
    if (github?.[1]) {
      this.mutate(`github secret ${github[1]}`);
      this.githubSecrets.add(github[1]);
      return ok();
    }
    throw new Error(`Unexpected secret write: ${command}`);
  }

  // ── HTTP: the Cloudflare API and the live site ────────────────────────────

  private hasCname(host: string): boolean {
    return this.dns.some(
      (r) => r.type === 'CNAME' && r.name === host && r.content === PAGES_SUBDOMAIN,
    );
  }

  private domainStatus(host: string): string {
    return this.hasCname(host) && !this.pendingHosts.has(host) ? 'active' : 'pending';
  }

  private fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') this.mutate(`${method} ${url.pathname}`);

    if (url.origin === 'https://lasvegasfortransit.org') {
      return Promise.resolve(new Response('<!doctype html>', { status: 200 }));
    }
    if (!url.href.startsWith(CF_API)) throw new Error(`Unexpected request: ${method} ${url.href}`);
    const route = url.pathname.slice(new URL(CF_API).pathname.length);
    return Promise.resolve(this.cloudflareApi(method, route, url.searchParams, init));
  }

  private cloudflareApi(
    method: string,
    route: string,
    query: URLSearchParams,
    init: RequestInit | undefined,
  ): Response {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const project = /^\/accounts\/([^/]+)\/pages\/projects\/([^/]+)(\/domains)?$/.exec(route);
    if (project?.[2]) {
      if (project[1] !== FAKE_ACCOUNT_ID) return cfError(403, 10000, 'Authentication error');
      return this.pagesApi(method, decodeURIComponent(project[2]), Boolean(project[3]), body);
    }
    if (route === `/accounts/${FAKE_ACCOUNT_ID}/workers/domains`) {
      return this.workerDomainsApi(method, query, body);
    }
    if (route === `/accounts/${FAKE_ACCOUNT_ID}/workers/scripts/lvbt-website/deployments`) {
      return this.workerDeployed
        ? cfResult({ deployments: [{ id: 'worker-deployment-fake' }] })
        : cfError(404, 10007, 'Worker not found');
    }
    if (route === '/zones') {
      return cfResult(query.get('name') === this.zone.name ? [this.zone] : []);
    }
    const records = /^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/.exec(route);
    if (records?.[1] === this.zone.id) return this.dnsApi(method, query, records[2], body);
    throw new Error(`Unexpected Cloudflare API call: ${method} ${route}`);
  }

  private workerDomainsApi(method: string, query: URLSearchParams, body: unknown): Response {
    if (method === 'GET') {
      const hostname = query.get('hostname');
      return cfResult(
        [...this.workerDomains]
          .filter(([host]) => !hostname || host === hostname)
          .map(([host, service]) => ({
            hostname: host,
            service,
            zone_id: this.zone.id,
            zone_name: this.zone.name,
          })),
      );
    }
    const domain = body as { hostname: string; service: string };
    this.mutate(`worker domain ${domain.hostname}`);
    this.workerDomains.set(domain.hostname, domain.service);
    return cfResult({
      ...domain,
      zone_id: this.zone.id,
      zone_name: this.zone.name,
    });
  }

  private pagesApi(method: string, name: string, domains: boolean, body: unknown): Response {
    const state = this.projects.get(name);
    if (!state) return cfError(404, 8000007, 'Project not found');
    if (!domains) {
      return cfResult({
        name,
        subdomain: PAGES_SUBDOMAIN,
        domains: [...state.domains],
        production_branch: 'main',
        canonical_deployment: state.production,
      });
    }
    if (method === 'GET') {
      return cfResult(
        [...state.domains].map((host) => ({ name: host, status: this.domainStatus(host) })),
      );
    }
    const host = (body as { name: string }).name;
    if (state.domains.has(host)) return cfError(400, 8000018, 'Domain already attached');
    state.domains.add(host);
    return cfResult({ name: host, status: 'pending' });
  }

  private dnsApi(
    method: string,
    query: URLSearchParams,
    recordId: string | undefined,
    body: unknown,
  ): Response {
    if (method === 'GET') {
      const name = query.get('name');
      const type = query.get('type');
      return cfResult(this.dns.filter((r) => r.name === name && r.type === type));
    }
    const fields = body as Omit<DnsRecordState, 'id'>;
    const existing = this.dns.find((r) => r.id === recordId);
    if (existing) {
      Object.assign(existing, fields);
      return cfResult(existing);
    }
    const created = { ...fields, id: `record-${this.dns.length + 1}` };
    this.dns.push(created);
    return cfResult(created);
  }
}
