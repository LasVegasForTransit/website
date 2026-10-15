import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { verifyPrintedSheet } from './support/release-page';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const sheet = page.getByRole('region', { name: 'Printable signup sheet', exact: true });
  async function fixture(overflow: 'visible' | 'auto' | 'hidden') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(`
      <a class="staff-back" href="#">Back to paper signup</a>
      <section class="staff-signup-sheet" aria-label="Printable signup sheet" tabindex="0"
        style="width:360px;overflow-x:${overflow}">
        <table style="width:650px">
          <thead><tr><th scope="col">Mailing-list signup Yes</th></tr></thead>
          <tbody>${Array.from({ length: 12 }, () => '<tr><td><span class="staff-signup-checkbox" aria-hidden="true"></span></td></tr>').join('')}</tbody>
        </table>
      </section>`);
    assert.equal(
      await sheet.evaluate((element) => element.scrollWidth > element.clientWidth),
      true,
    );
    assert.equal(await sheet.evaluate((element) => getComputedStyle(element).overflowX), overflow);
  }

  // Visible table overflow is not a scroll container, even when scrollWidth exceeds clientWidth.
  await fixture('visible');
  await verifyPrintedSheet(page);
  assert.equal(await sheet.evaluate((element) => element.scrollLeft), 0);

  await fixture('auto');
  await page.setViewportSize({ width: 390, height: 900 });
  await verifyPrintedSheet(page);
  assert.ok(await sheet.evaluate((element) => element.scrollLeft > 0));

  // A genuine scroll container must still respond to the member's native arrow key.
  await fixture('auto');
  await sheet.evaluate((element) =>
    element.addEventListener('keydown', (event) => event.preventDefault()),
  );
  await assert.rejects(verifyPrintedSheet(page), /Timeout/);

  await fixture('hidden');
  await assert.rejects(verifyPrintedSheet(page), /visible or keyboard-scrollable/);
  console.log(
    'Print-sheet keyboard audit: visible desktop overflow, native phone scroll and blocked-key rejection passed',
  );
} finally {
  await browser.close();
}
