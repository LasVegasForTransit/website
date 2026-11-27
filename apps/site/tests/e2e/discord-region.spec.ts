import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import {
  discordRuntime,
  ORIGIN,
  DISCORD_USER,
  DISCORD_ROLES,
} from '../runtime/support/discord-runtime';
import { t } from '@lasvegasfortransit/platform-core/messages';
const east = '101010101010101010',
  west = '121212121212121212';
const fixture = await discordRuntime();
// The fixture's Discord server cannot register slash commands, so the first scheduled run fails
// and closes that day's scheduled budget. Later runs skip the command until its retry time, so
// each retry starts a fresh budget day, as the jobs scheduled spec does.
async function settle() {
  let outcome = '';
  for (let attempt = 0; attempt < 3 && outcome !== 'ok'; attempt++) {
    outcome = (await fixture.jobs.scheduled({ cron: '* * * * *' })).outcome;
    if (outcome !== 'ok')
      await fixture.db
        .prepare(
          "UPDATE scheduled_work_budget SET utc_day='2000-01-01',lease_until='1970-01-01T00:00:00.000Z'",
        )
        .run();
  }
  assert.equal(outcome, 'ok');
}
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
    '--no-proxy-server',
  ],
});
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 320, height: 568 },
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/*', async (route) => {
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/account/`);
  const checkbox = page.getByRole('checkbox', { name: t('discord.regionSharing'), exact: true });
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await page.getByText(t('discord.regionHint'), { exact: true }).isVisible(), true);
  for (let index = 0; index < 60; index++) {
    if (await checkbox.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  assert.equal(await checkbox.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByRole('button', { name: t('account.save'), exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await Promise.all([page.waitForURL(`${ORIGIN}/account/`), page.keyboard.press('Enter')]);
  await page.getByText(t('discord.regionSaved'), { exact: true }).waitFor();
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(`${fixture.root}/test-results/discord`, { recursive: true });
  await page.screenshot({
    path: `${fixture.root}/test-results/discord/region-sharing-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const csrf = await fixture.simulator.dispatchFetch(`${ORIGIN}/account/discord/region/`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.invalid',
      Cookie: `__Host-lvbt_session=${fixture.session.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'visible=1',
  });
  assert.equal(csrf.status, 403);
  await fixture.people.linkIdentity(fixture.person.id, {
    platform: 'discord',
    externalId: DISCORD_USER.id,
    linkMethod: 'self_linked',
  });
  fixture.scenario.joined = true;
  await fixture.db
    .prepare('UPDATE regions SET discord_role_id=? WHERE id=?')
    .bind(east, 'east_las_vegas')
    .run();
  await fixture.db
    .prepare('UPDATE regions SET discord_role_id=? WHERE id=?')
    .bind(west, 'summerlin')
    .run();
  await fixture.people.setRegion(fixture.person.id, 'east_las_vegas', 'member_choice');
  await settle();
  assert.equal(
    fixture.scenario.roles.has(east),
    false,
    'a pre-connection hide choice remains private',
  );
  await page.reload();
  await checkbox.check();
  await Promise.all([
    page.waitForURL(`${ORIGIN}/account/`),
    page.getByRole('button', { name: t('account.save'), exact: true }).click(),
  ]);
  await page.getByText(t('discord.regionSaved'), { exact: true }).waitFor();
  await settle();
  assert.equal(fixture.scenario.roles.has(east), true);
  await fixture.people.setRegion(fixture.person.id, 'summerlin', 'member_choice');
  await settle();
  assert.equal(fixture.scenario.roles.has(east), false);
  assert.equal(fixture.scenario.roles.has(west), true);
  assert.equal(fixture.scenario.roles.has(DISCORD_ROLES.unmanaged), true);
  await fixture.db.prepare('DELETE FROM sessions WHERE person_id=?').bind(fixture.person.id).run();
  const stale = await fixture.simulator.dispatchFetch(`${ORIGIN}/account/discord/region/`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Origin: ORIGIN,
      Cookie: `__Host-lvbt_session=${fixture.session.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  assert.equal(stale.status, 303);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT discord_region_visible AS visible FROM people WHERE id=?')
        .bind(fixture.person.id)
        .first<{ visible: number }>()
    )?.visible,
    1,
  );
  console.log(
    'Compiled region sharing: native keyboard/no-JS save, session/CSRF refusal, pre-connection privacy, scheduled swaps and unmanaged-role preservation passed.',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
