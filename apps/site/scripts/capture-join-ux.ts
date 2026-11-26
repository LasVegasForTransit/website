/** Capture the complete local Join review set from a built preview. No form sends data. */
import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const host = 'http://127.0.0.1:4330';
const output = resolve(process.cwd(), '../../docs/design/join-ux-screenshots');
const base = '/prototypes/join/vision/';
const request = `${base}transit-accountability-briefs/`;
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const manifest: { file: string; label: string; viewport: string; url: string }[] = [];

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const desktopPage = await browser.newPage({ viewport: desktop, reducedMotion: 'reduce' });
  const mobilePage = await browser.newPage({ viewport: mobile, reducedMotion: 'reduce' });

  async function capture(
    file: string,
    label: string,
    path: string,
    options: { fullPage?: boolean; prepare?: (page: Page) => Promise<void> } = {},
  ) {
    const page = file.includes('-mobile') ? mobilePage : desktopPage;
    const url = new URL(path, host).toString();
    await page.goto(url, { waitUntil: 'networkidle' });
    // A hash-only navigation reuses the prior document and does not rerun the prototype script.
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-join-vision]').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (path.endsWith('#interest')) await form(page).waitFor({ state: 'visible' });
    await options.prepare?.(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({ path: resolve(output, file), fullPage: options.fullPage });
    manifest.push({
      file,
      label,
      viewport: page === desktopPage ? '1440 × 900' : '390 × 844',
      url: path,
    });
    console.log(`${manifest.length}. ${file}`);
  }

  const form = (page: Page) => page.locator('[data-request-interest-dialog]');
  const roleForm = (page: Page) => page.locator('[data-role-dialog]');
  const toBottom = async (page: Page) => {
    await form(page).evaluate((dialog) => {
      dialog.scrollTop = dialog.scrollHeight;
    });
  };
  const validContact = async (page: Page) => {
    await form(page).locator('input[name="name"]').fill('Review Volunteer');
    await form(page).locator('input[name="email"]').fill('review@example.com');
    await form(page).locator('input[name="phone"]').fill('(702) 555-0199');
  };

  await capture('01-public-join-desktop.png', 'Public Join', `${base}?presentation=1#join`, {
    fullPage: true,
  });
  await capture('02-public-join-mobile.png', 'Public Join', `${base}?presentation=1#join`, {
    fullPage: true,
  });
  await capture(
    '03-member-home-desktop.png',
    'Signed-in member home',
    `${base}?presentation=1&member=1#member`,
    { fullPage: true },
  );
  await capture(
    '04-member-home-mobile.png',
    'Signed-in member home',
    `${base}?presentation=1&member=1#member`,
    { fullPage: true },
  );

  const finder = (step: number) =>
    `${base}?presentation=1&member=1&interest=build&pace=once&step=${step}#finder`;
  for (const step of [1, 2, 3]) {
    await capture(
      `${String(step * 2 + 3).padStart(2, '0')}-member-step-${step}-desktop.png`,
      `Member questions: step ${step}`,
      finder(step),
    );
    await capture(
      `${String(step * 2 + 4).padStart(2, '0')}-member-step-${step}-mobile.png`,
      `Member questions: step ${step}`,
      finder(step),
    );
  }

  await capture(
    '11-contributor-request-desktop.png',
    'Contributor request',
    `${request}?presentation=1#request`,
    { fullPage: true },
  );
  await capture(
    '12-contributor-request-mobile.png',
    'Contributor request',
    `${request}?presentation=1#request`,
    { fullPage: true },
  );
  await capture(
    '13-public-form-desktop.png',
    'Public contributor form, contact and résumé',
    `${request}?presentation=1#interest`,
  );
  await capture(
    '14-public-form-choices-desktop.png',
    'Public contributor form, project choices and context',
    `${request}?presentation=1#interest`,
    { prepare: toBottom },
  );
  await capture(
    '15-public-form-mobile.png',
    'Public contributor form, contact and résumé',
    `${request}?presentation=1#interest`,
  );
  await capture(
    '16-public-form-choices-mobile.png',
    'Public contributor form, project choices and context',
    `${request}?presentation=1#interest`,
    { prepare: toBottom },
  );
  await capture(
    '17-public-validation.png',
    'Inline email and phone errors',
    `${request}?presentation=1#interest`,
    {
      prepare: async (page) => {
        await form(page).locator('input[name="name"]').fill('Review Volunteer');
        await form(page).locator('input[name="email"]').fill('invalid@');
        await form(page).locator('input[name="phone"]').fill('not a phone number');
        await form(page)
          .getByRole('button', { name: /Send interest/ })
          .click();
      },
    },
  );
  await capture(
    '18-public-confirmation.png',
    'Public confirmation and optional membership',
    `${request}?presentation=1#interest`,
    {
      prepare: async (page) => {
        await validContact(page);
        await form(page).getByText('Not sure yet', { exact: true }).click();
        await form(page)
          .getByRole('button', { name: /Send interest/ })
          .click();
      },
    },
  );

  await capture(
    '19-member-form-desktop.png',
    'Signed-in form with account details',
    `${request}?presentation=1&member=1#interest`,
  );
  await capture(
    '20-member-form-mobile.png',
    'Signed-in form with account details',
    `${request}?presentation=1&member=1#interest`,
  );
  await capture(
    '21-member-confirmation.png',
    'Signed-in confirmation',
    `${request}?presentation=1&member=1#interest`,
    {
      prepare: async (page) => {
        await form(page).getByText('Not sure yet', { exact: true }).click();
        await form(page)
          .getByRole('button', { name: /Send interest/ })
          .click();
      },
    },
  );

  await capture('22-role-desktop.png', 'Leadership role', `${base}?presentation=1#role`, {
    fullPage: true,
  });
  await capture('23-role-mobile.png', 'Leadership role', `${base}?presentation=1#role`, {
    fullPage: true,
  });
  const openRole = async (page: Page) => {
    await page.locator('[data-screen="role"] [data-open-role]').first().click();
    await roleForm(page).waitFor({ state: 'visible' });
  };
  await capture(
    '24-role-application-desktop.png',
    'Leadership application',
    `${base}?presentation=1#role`,
    { prepare: openRole },
  );
  await capture(
    '25-role-application-mobile.png',
    'Leadership application',
    `${base}?presentation=1#role`,
    { prepare: openRole },
  );
  await capture(
    '26-membership-committee-desktop.png',
    'Membership Committee',
    `${base}?presentation=1#membership`,
    { fullPage: true },
  );
  await capture(
    '27-membership-committee-mobile.png',
    'Membership Committee',
    `${base}?presentation=1#membership`,
    { fullPage: true },
  );
  await capture(
    '28-public-engagement-team-desktop.png',
    'Public Engagement Team',
    `${base}?presentation=1#group`,
    { fullPage: true },
  );
  await capture(
    '29-committee-inquiry.png',
    'Committee inquiry',
    `${base}?presentation=1#membership`,
    {
      prepare: async (page) =>
        page.locator('[data-screen="membership"] [data-open-sample]').click(),
    },
  );
  await capture('30-team-inquiry.png', 'Team inquiry', `${base}?presentation=1#group`, {
    prepare: async (page) => page.locator('[data-screen="group"] [data-open-sample]').click(),
  });
  await capture(
    '31-public-confirmation-mobile.png',
    'Public contributor confirmation on mobile',
    `${request}?presentation=1#interest`,
    {
      prepare: async (page) => {
        await validContact(page);
        await form(page).getByText('Not sure yet', { exact: true }).click();
        await form(page)
          .getByRole('button', { name: /Send interest/ })
          .click();
      },
    },
  );
  await capture(
    '32-member-confirmation-mobile.png',
    'Signed-in contributor confirmation on mobile',
    `${request}?presentation=1&member=1#interest`,
    {
      prepare: async (page) => {
        await form(page).getByText('Not sure yet', { exact: true }).click();
        await form(page)
          .getByRole('button', { name: /Send interest/ })
          .click();
      },
    },
  );
  const confirmRole = async (page: Page) => {
    await openRole(page);
    await roleForm(page).locator('input[name="name"]').fill('Review Volunteer');
    await roleForm(page).locator('input[name="email"]').fill('review@example.com');
    await roleForm(page)
      .getByRole('button', { name: /Send application/ })
      .click();
  };
  await capture(
    '33-role-confirmation-desktop.png',
    'Leadership application confirmation',
    `${base}?presentation=1#role`,
    { prepare: confirmRole },
  );
  await capture(
    '34-role-confirmation-mobile.png',
    'Leadership application confirmation on mobile',
    `${base}?presentation=1#role`,
    { prepare: confirmRole },
  );
  await capture(
    '35-role-opening-desktop.png',
    'Leadership role opening',
    `${base}?presentation=1#role`,
  );
  await capture(
    '36-role-opening-mobile.png',
    'Leadership role opening',
    `${base}?presentation=1#role`,
  );

  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
}
