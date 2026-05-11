/**
 * One-shot script: generates public/og-default.png at 1200×630.
 * Run: pnpm tsx scripts/generate-og-image.ts
 * Commit the output — no build-time regen needed unless logo/copy changes.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og-default.png');

// The HTML lives in tmpdir() and Playwright loads it via file://, so the
// browser has filesystem read access to siblings. A plain file:// URL in
// @font-face works — no base64 inlining required.
const fontUrl = `file://${join(ROOT, 'node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2')}`;

// On Dark variant: cream rings, lightened letter fills (readable on dark background)
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 260 260" fill="none">
  <defs>
    <clipPath id="cv"><rect x="138" y="24" width="98" height="98" rx="48"/></clipPath>
    <clipPath id="cb"><rect x="24" y="138" width="98" height="98" rx="48"/></clipPath>
    <clipPath id="ct"><rect x="138" y="138" width="98" height="98" rx="48"/></clipPath>
  </defs>
  <rect x="17.9048" y="17.9048" width="110.19" height="110.19" rx="54.0952" stroke="#F1DFDA" stroke-width="12.1905" fill="none"/>
  <rect x="131.905" y="17.9048" width="110.19" height="110.19" rx="54.0952" stroke="#F1DFDA" stroke-width="12.1905" fill="none"/>
  <rect x="17.9048" y="131.905" width="110.19" height="110.19" rx="54.0952" stroke="#F1DFDA" stroke-width="12.1905" fill="none"/>
  <rect x="131.905" y="131.905" width="110.19" height="110.19" rx="54.0952" stroke="#F1DFDA" stroke-width="12.1905" fill="none"/>
  <path fill="#C49A8C" d="M53.7557 104V41.2023H70.6494V90.1029H95.7511V104H53.7557Z"/>
  <g clip-path="url(#cv)"><path fill="#C49A8C" d="M177.688 104L156.495 41.2023H172.433L186.982 84.1966L201.487 41.2023H217.469L196.275 104H177.688Z"/></g>
  <g clip-path="url(#cb)"><path fill="#A88A80" d="M48.5816 218V155.202H73.6833C82.4559 155.202 88.8399 156.635 92.8353 159.502C96.8597 162.339 98.8719 166.436 98.8719 171.792C98.8719 174.687 98.1481 177.25 96.7005 179.479C95.2528 181.708 92.5892 183.778 88.7096 185.689C91.4601 186.5 93.617 187.528 95.1805 188.773C96.7728 190.018 97.9309 191.349 98.6548 192.768C99.3786 194.187 99.8418 195.605 100.044 197.024C100.247 198.414 100.348 199.702 100.348 200.889C100.348 206.738 98.4087 211.051 94.529 213.831C90.6784 216.61 84.193 218 75.073 218H48.5816ZM65.4753 205.319H75.681C78.1709 205.319 80.0384 204.653 81.2833 203.321C82.5283 201.96 83.1508 200.455 83.1508 198.805C83.1508 197.646 82.8612 196.619 82.2822 195.721C81.7031 194.795 80.878 194.071 79.8068 193.55C78.7645 193 77.534 192.725 76.1153 192.725H65.4753V205.319ZM65.4753 179.696H76.1153C77.1287 179.696 78.0262 179.551 78.8079 179.262C79.6186 178.972 80.2989 178.581 80.849 178.089C81.4281 177.568 81.8624 176.96 82.1519 176.265C82.4704 175.541 82.6296 174.774 82.6296 173.963C82.6296 172.082 81.9348 170.605 80.545 169.534C79.1843 168.434 77.505 167.883 75.5073 167.883H65.4753V179.696Z"/></g>
  <g clip-path="url(#ct)"><path fill="#9C9060" d="M178.457 218V170.055H160.651V155.202H213.373V170.055H195.394V218H178.457Z"/></g>
</svg>`;

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @font-face {
      font-family: 'Public Sans';
      src: url('${fontUrl}') format('woff2');
      font-weight: 100 900;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1200px;
      height: 630px;
      overflow: hidden;
    }
    body {
      background: #0F1115;
      display: flex;
      align-items: center;
      gap: 64px;
      padding: 64px 80px;
      font-family: 'Public Sans', system-ui, sans-serif;
    }
    .logo { flex-shrink: 0; }
    .text { flex: 1; }
    h1 {
      font-size: 62px;
      font-weight: 700;
      color: #F1DFDA;
      line-height: 1.1;
      margin-bottom: 18px;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 26px;
      font-weight: 400;
      color: #7A6A66;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="logo">${logoSvg}</div>
  <div class="text">
    <h1>Las&nbsp;Vegans for Better&nbsp;Transit</h1>
    <p>Better transit, safer streets,<br>a Vegas that works for everyone.</p>
  </div>
</body>
</html>`;

// Write to a temp HTML file so Playwright can load it with file:// (needed for local font paths)
const tmpHtml = join(tmpdir(), 'lvbt-og-card.html');
writeFileSync(tmpHtml, html, 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`file://${tmpHtml}`);
  await page.waitForTimeout(200); // let font render
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
} finally {
  await browser.close();
}

console.log(`✓ og-default.png written to ${OUT}`);
