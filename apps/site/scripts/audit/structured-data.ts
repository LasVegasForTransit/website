#!/usr/bin/env tsx
/**
 * Validate JSON-LD structured data in every built HTML page.
 *
 * Checks:
 *  - Each page has at least one <script type="application/ld+json">
 *  - Each script body parses as JSON
 *  - Each parsed object has @context (schema.org) and @type
 *  - The Organization schema (emitted by BaseLayout) appears on every page
 *
 * Usage: tsx scripts/audit/structured-data.ts [--dist=path] [--json]
 *   exit 0 = clean, exit 1 = problems printed
 */

import { readFileSync } from 'node:fs';
import { distHtmlFiles, parseAuditArgs, relFromDist } from './_shared.js';

interface Finding {
  page: string;
  problem: string;
}

const { distDir, asJson } = parseAuditArgs();

const SCRIPT_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
// Astro emits a meta-refresh stub for every entry in astro.config.mjs
// `redirects` (e.g. /join → /go). Those pages exist only to bounce
// visitors and are overridden by real 301s in production via
// public/_redirects; they carry no content, so the JSON-LD requirement
// doesn't apply.
const REDIRECT_STUB_RE = /<meta\s+http-equiv=["']refresh["']/i;
const findings: Finding[] = [];
const notes: Finding[] = [];
const htmlFiles = distHtmlFiles(distDir);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaTypeIs(obj: Record<string, unknown>, type: string): boolean {
  const schemaType = obj['@type'];
  return schemaType === type || (Array.isArray(schemaType) && schemaType.includes(type));
}

// Pushes a finding for every prop in `props` that isn't a non-empty string
// on `obj`, using `describe` to phrase the message for that prop.
function requireStrings(
  page: string,
  obj: Record<string, unknown>,
  props: string[],
  describe: (prop: string) => string,
): void {
  for (const prop of props) {
    if (typeof obj[prop] !== 'string' || obj[prop] === '') {
      findings.push({ page, problem: describe(prop) });
    }
  }
}

function checkPlaceLocation(page: string, location: Record<string, unknown>): void {
  const address = location.address;
  if (!isObject(address)) {
    findings.push({ page, problem: 'Event physical location missing PostalAddress' });
    return;
  }
  requireStrings(
    page,
    address,
    ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'],
    (prop) => `Event physical location missing address.${prop}`,
  );
}

function checkEventOffer(page: string, offer: unknown): void {
  if (!isObject(offer)) {
    findings.push({ page, problem: 'Event offers is not an object' });
    return;
  }
  requireStrings(
    page,
    offer,
    ['url', 'priceCurrency', 'availability'],
    (prop) => `Event offer missing ${prop}`,
  );
  if (typeof offer.price !== 'number' && typeof offer.price !== 'string') {
    findings.push({ page, problem: 'Event offer missing price' });
  }
}

function checkRegisterAction(page: string, action: unknown): void {
  if (!isObject(action)) {
    findings.push({ page, problem: 'Event potentialAction is not an object' });
    return;
  }
  if (action['@type'] !== 'RegisterAction') {
    findings.push({ page, problem: 'Event potentialAction is not RegisterAction' });
  }
  if (typeof action.target !== 'string' || action.target === '') {
    findings.push({ page, problem: 'Event RegisterAction missing target' });
  }
}

function checkEvent(page: string, event: Record<string, unknown>): void {
  requireStrings(
    page,
    event,
    [
      '@id',
      'name',
      'description',
      'startDate',
      'eventStatus',
      'url',
      'mainEntityOfPage',
      'inLanguage',
    ],
    (prop) => `Event missing ${prop}`,
  );

  if (!isObject(event.identifier) || event.identifier.propertyID !== 'lvbt-event-slug') {
    findings.push({ page, problem: 'Event missing lvbt-event-slug identifier' });
  }
  if (!isObject(event.organizer) || event.organizer['@type'] !== 'Organization') {
    findings.push({ page, problem: 'Event missing Organization organizer' });
  }
  if (!Array.isArray(event.image) || event.image.length === 0) {
    findings.push({ page, problem: 'Event missing image' });
  }
  if (event.offers !== undefined) checkEventOffer(page, event.offers);
  if (event.potentialAction !== undefined) checkRegisterAction(page, event.potentialAction);

  const location = event.location;
  if (!location) {
    notes.push({ page, problem: 'Google Event rich result ineligible: no location yet' });
    return;
  }

  const locations = Array.isArray(location)
    ? location.filter(isObject)
    : isObject(location)
      ? [location]
      : [];
  if (locations.length === 0) {
    findings.push({ page, problem: 'Event location is not an object' });
    return;
  }

  const hasVirtual = locations.some((loc) => loc['@type'] === 'VirtualLocation');
  const places = locations.filter((loc) => loc['@type'] === 'Place');
  if (hasVirtual) {
    notes.push({
      page,
      problem: 'Google Event rich result ineligible: includes virtual attendance',
    });
  }
  for (const place of places) checkPlaceLocation(page, place);
}

for (const file of htmlFiles) {
  const page = relFromDist(distDir, file);
  const html = readFileSync(file, 'utf8');
  if (REDIRECT_STUB_RE.test(html)) continue;
  const blocks = [...html.matchAll(SCRIPT_RE)].map((m) => m[1] ?? '');

  if (blocks.length === 0) {
    findings.push({ page, problem: 'no JSON-LD <script> blocks found' });
    continue;
  }

  let hasOrg = false;
  let eventObject: Record<string, unknown> | undefined;
  for (const [idx, raw] of blocks.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (err) {
      findings.push({ page, problem: `block #${idx} not valid JSON: ${(err as Error).message}` });
      continue;
    }
    if (!isObject(parsed) && !Array.isArray(parsed)) {
      findings.push({ page, problem: `block #${idx} not an object` });
      continue;
    }
    const wrapper = isObject(parsed) ? parsed : undefined;
    const wrapperContext = wrapper?.['@context'];
    const graph = wrapper?.['@graph'];
    const items = Array.isArray(parsed)
      ? parsed.filter(isObject)
      : Array.isArray(graph)
        ? graph.filter(isObject)
        : wrapper
          ? [wrapper]
          : [];
    if (wrapperContext !== 'https://schema.org') {
      findings.push({ page, problem: `block #${idx} missing @context=https://schema.org` });
    }
    for (const item of items) {
      const obj = item;
      if (typeof obj['@type'] !== 'string' && !Array.isArray(obj['@type'])) {
        findings.push({ page, problem: `block #${idx} missing @type` });
      }
      if (schemaTypeIs(obj, 'Organization')) hasOrg = true;
      if (schemaTypeIs(obj, 'Event') || String(obj['@type']).endsWith('Event')) eventObject = obj;
    }
  }

  if (!hasOrg) findings.push({ page, problem: 'missing Organization schema (BaseLayout default)' });
  if (/^\/events\/[^/]+\/$/.test(page) && eventObject) {
    checkEvent(page, eventObject);
  }
}

if (asJson) {
  process.stdout.write(
    JSON.stringify({ ok: findings.length === 0, findings, notes }, null, 2) + '\n',
  );
} else if (findings.length === 0) {
  process.stdout.write(`structured-data: ok (${htmlFiles.length} pages checked)\n`);
  if (notes.length > 0) {
    for (const n of notes) process.stdout.write(`  note ${n.page}: ${n.problem}\n`);
    process.stdout.write(`structured-data: ${notes.length} non-fatal note(s)\n`);
  }
} else {
  for (const f of findings) process.stderr.write(`  ${f.page}: ${f.problem}\n`);
  for (const n of notes) process.stderr.write(`  note ${n.page}: ${n.problem}\n`);
  process.stderr.write(`structured-data: ${findings.length} problem(s)\n`);
}
process.exit(findings.length === 0 ? 0 : 1);
