import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SECURITY_HEADERS } from '../functions/join/_page';
import { normalizePhone, readJoinForm, validateJoin } from '../platform/core/join-form';
import { membershipStatus } from '../platform/core/membership';
import { mayReplaceRegion, regionForPlaces, REGIONS } from '../platform/core/regions';
import { signToken, verifyToken } from '../platform/core/signing';
import { ulid } from '../platform/core/ids';
import { parseGeocodeResponse } from '../platform/integrations/census';
import { createTranslator, en, formatDate, formatTime, t } from '../platform/messages';

const root = new URL('../', import.meta.url);

void test('a signed token verifies only for its purpose and until it expires', async () => {
  const token = await signToken('secret', {
    purpose: 'remove_email',
    subject: 'person-1',
    expiresAt: Date.now() + 60_000,
  });
  assert.equal((await verifyToken('secret', token, 'remove_email'))?.subject, 'person-1');
  assert.equal(await verifyToken('secret', token, 'join_step'), null);
  assert.equal(await verifyToken('other-secret', token, 'remove_email'), null);
  assert.equal(await verifyToken('secret', token, 'remove_email', Date.now() + 120_000), null);
  const [body, signature] = token.split('.');
  assert.equal(await verifyToken('secret', `${body}x.${signature}`, 'remove_email'), null);
});

void test('ULIDs are 26 characters and sort by creation time', () => {
  const earlier = ulid(1_700_000_000_000);
  const later = ulid(1_800_000_000_000);
  assert.equal(earlier.length, 26);
  assert.ok(earlier < later);
});

void test('places map to LVBT regions, and Las Vegas city is left to the member', () => {
  assert.equal(regionForPlaces('320030041011000', ['Sunrise Manor CDP']), 'east_las_vegas');
  assert.equal(regionForPlaces('320030041011000', ['Summerlin South CDP']), 'summerlin');
  assert.equal(regionForPlaces('320030041011000', ['Henderson city']), 'henderson_boulder_city');
  assert.equal(regionForPlaces('320030041011000', ['Las Vegas city']), null);
  assert.equal(regionForPlaces('320030041011000', ['Laughlin CDP']), 'outside_valley');
  assert.equal(regionForPlaces('060370001001000', []), null);
  assert.equal(REGIONS.length, 10);
});

void test('region sources rank staff, address, member choice, then ZIP code', () => {
  assert.equal(mayReplaceRegion(null, 'zip'), true);
  assert.equal(mayReplaceRegion('member_choice', 'zip'), false);
  assert.equal(mayReplaceRegion('zip', 'member_choice'), true);
  assert.equal(mayReplaceRegion('member_choice', 'address'), true);
  assert.equal(mayReplaceRegion('staff', 'address'), true);
  assert.equal(mayReplaceRegion('staff', 'zip'), false);
});

void test('the Geocoder answer yields the block, ZIP code and places', () => {
  const result = parseGeocodeResponse({
    result: {
      addressMatches: [
        {
          addressComponents: { zip: '89101' },
          geographies: {
            'Census Blocks': [{ GEOID: '320030007001001' }],
            'Incorporated Places': [{ NAME: 'Las Vegas city' }],
          },
        },
      ],
    },
  });
  assert.deepEqual(result, {
    kind: 'match',
    censusBlock: '320030007001001',
    vintage: '2020',
    zip: '89101',
    places: ['Las Vegas city'],
  });
  assert.deepEqual(parseGeocodeResponse({ result: { addressMatches: [] } }), { kind: 'no_match' });
});

void test('membership status follows the newsletter consent', () => {
  assert.equal(membershipStatus([]), 'not_member');
  assert.equal(membershipStatus([{ scope: 'newsletter', withdrawnAt: null }]), 'member');
  assert.equal(
    membershipStatus([{ scope: 'newsletter', withdrawnAt: '2026-01-01' }]),
    'former_member',
  );
  assert.equal(membershipStatus([{ scope: 'event_reminders', withdrawnAt: null }]), 'not_member');
});

void test('the join form reads and checks its fields', () => {
  const data = new FormData();
  data.append('email', ' Ana@Example.org ');
  data.append('interests', 'events');
  data.append('interests', 'not-a-real-interest');
  data.append('consent', 'yes');
  data.append('phone', '(702) 555-0123');
  const input = readJoinForm(data);
  assert.equal(input.email, 'ana@example.org');
  assert.deepEqual(input.interests, ['events']);
  assert.equal(input.origin, 'join_form');
  assert.deepEqual(validateJoin(input), {});
  assert.equal(normalizePhone('(702) 555-0123'), '+17025550123');
  assert.equal(normalizePhone('555-0123'), null);
});

void test('messages fill values, choose plurals and pseudo-localize', () => {
  assert.equal(t('welcome.headingNamed', { name: 'Ana' }), "You're in, Ana.");
  const catalog = { tries: { one: '{count} try left', other: '{count} tries left' } };
  const english = createTranslator(catalog);
  assert.equal(english('tries', { count: 1 }), '1 try left');
  assert.equal(english('tries', { count: 4 }), '4 tries left');
  const pseudo = createTranslator(catalog, 'en-XA')('tries', { count: 2 });
  assert.ok(pseudo.startsWith('['));
  assert.ok(pseudo.length > '2 tries left'.length * 1.3);
  assert.throws(() => english('missing.key'), /Missing message: missing.key/);
});

void test('dates and times read in Pacific Time across a daylight saving change', () => {
  assert.equal(formatDate(new Date('2026-10-03T19:00:00Z')), 'Sat, Oct 3');
  assert.equal(formatTime(new Date('2026-10-03T01:30:00Z')), '6:30 pm');
  assert.equal(formatTime(new Date('2026-11-07T02:30:00Z')), '6:30 pm');
});

function sourceFiles(directory: URL): string[] {
  const files: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|astro|js|mjs)$/.test(name)) files.push(full);
    }
  };
  walk(directory.pathname);
  return files;
}

function catalogKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (typeof node !== 'object' || node === null) return [];
  if ('other' in node) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    catalogKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

void test('every catalog key is used and every used key exists', () => {
  const code = ['src/', 'platform/', 'functions/']
    .flatMap((dir) => sourceFiles(new URL(dir, root)))
    .filter((file) => !file.includes('/platform/messages/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const used = new Set([...code.matchAll(/\bt\(\s*'([a-zA-Z.]+)'/g)].map((match) => match[1]));
  const defined = new Set(catalogKeys(en));
  const missing = [...used].filter((key) => key && !defined.has(key));
  const unused = [...defined].filter((key) => !used.has(key));
  assert.deepEqual(
    missing,
    [],
    `keys used in code but missing from the catalog: ${missing.join(', ')}`,
  );
  assert.deepEqual(unused, [], `catalog keys used nowhere: ${unused.join(', ')}`);
});

void test('pages built on request send the same security headers as public/_headers', () => {
  const headersFile = readFileSync(new URL('public/_headers', root), 'utf8');
  const block = headersFile.split(/\n(?=\/)/)[0] ?? '';
  const fromFile = Object.fromEntries(
    [...block.matchAll(/^ {2}([\w-]+): (.+)$/gm)].map((match) => [match[1], match[2]]),
  );
  assert.deepEqual(SECURITY_HEADERS, fromFile);
});
