import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { DISCORD_USER } from './discord-runtime';

/** The page after connecting shows the verified account, synced access and the server hand-off. */
export async function confirmConnection(page: Page, screenshot: string): Promise<void> {
  await page.getByRole('heading', { name: 'Discord connected', exact: true }).waitFor();
  await page.getByText(`@${DISCORD_USER.username}`, { exact: true }).waitFor();
  await page.getByText('Member channels', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('link', { name: 'Open Discord', exact: true }).getAttribute('href'),
    'https://discord.com/channels/111111111111111111',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
}
