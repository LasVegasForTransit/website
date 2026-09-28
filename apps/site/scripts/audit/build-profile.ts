#!/usr/bin/env tsx
/**
 * Profiled build. Spawns `pnpm build` and samples the child process's
 * resident-set size every 250 ms via `ps -o rss=`. Reports peak RSS,
 * wall-clock duration, and the final build exit code. Compares peak to
 * perf-budgets.json `build.peakRssMb`; if the budget is null, the run
 * reports only (no fail). Appends every successful sample to
 * audits/build-stats.jsonl so the trend is inspectable without git
 * archaeology.
 *
 * Usage: tsx scripts/audit/build-profile.ts [--json]
 *   exit 0 = build succeeded and (if budget set) peak under budget
 *   exit 1 = build failed OR peak exceeded budget
 *
 * Cross-platform sampling: macOS and Linux both have `ps -o rss=` that
 * returns KB. Windows is not supported (Astro builds on Linux/macOS for
 * this project).
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BuildBudget {
  peakRssMb: number | null;
}

interface BuildStats {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  peakRssMb: number;
  budget: BuildBudget;
  reason?: string;
}

const asJson = process.argv.includes('--json');
const repoRoot = resolve(process.cwd());

function loadBudget(): BuildBudget {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, 'perf-budgets.json'), 'utf8')) as {
    build: BuildBudget;
  };
  return raw.build;
}

function sampleRssKb(pid: number): number {
  // `ps -o rss= -p <pid>` returns RSS in KB on macOS and Linux. Empty
  // output (process gone) returns 0, which the caller treats as "stop
  // sampling".
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  const trimmed = (out.stdout ?? '').trim();
  if (!trimmed) return 0;
  const n = Number(trimmed.split(/\s+/)[0]);
  return Number.isFinite(n) ? n : 0;
}

const budget = loadBudget();
const t0 = Date.now();
const child = spawn('pnpm', ['build'], { stdio: ['ignore', 'pipe', 'pipe'] });

let peakKb = 0;
const sampleInterval = setInterval(() => {
  const rss = sampleRssKb(child.pid ?? 0);
  if (rss > peakKb) peakKb = rss;
}, 250);

// Forward the child's output so a direct invocation shows build progress
// and an orchestrator invocation (baseline.ts runTool) captures the full
// build log — without that, a failed build's error message would be lost.
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

const exitCode: number | null = await new Promise((resolveExit) => {
  child.on('close', (code) => {
    clearInterval(sampleInterval);
    resolveExit(code);
  });
});

const durationMs = Date.now() - t0;
const peakRssMb = Number((peakKb / 1024).toFixed(1));
const buildOk = exitCode === 0;

const overBudget = budget.peakRssMb !== null && buildOk && peakRssMb > budget.peakRssMb;

const stats: BuildStats = {
  ok: buildOk && !overBudget,
  exitCode,
  durationMs,
  peakRssMb,
  budget,
  ...(buildOk
    ? overBudget
      ? { reason: `peak ${peakRssMb} MB > ${budget.peakRssMb} MB budget` }
      : {}
    : { reason: `build exited ${exitCode}` }),
};

// Append-only history. Skip on build failure (the row would just record
// noise). Create the audits/ dir if missing — first ever run.
if (buildOk) {
  const dir = resolve(repoRoot, 'audits');
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    resolve(dir, 'build-stats.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), durationMs, peakRssMb }) + '\n',
  );
}

if (asJson) {
  process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
} else if (buildOk) {
  process.stdout.write(
    `build-profile: peak ${peakRssMb} MB · ${(durationMs / 1000).toFixed(1)} s · budget ${
      budget.peakRssMb ?? 'null (report-only)'
    }\n`,
  );
  if (overBudget) process.stderr.write(`  over budget: ${stats.reason}\n`);
} else {
  process.stderr.write(`build-profile: build failed (exit ${exitCode})\n`);
}

process.exit(stats.ok ? 0 : 1);
