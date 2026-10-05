import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { selectAnnualPayment } from '../dist/payment.js';
import { nhiPagesHtml, paymentSelectorHtml, quotePageHtml } from './unsaved-journey-html.mjs';

const annualSelected = 'button[id$="~Kannually"] .hp-selected-box';
const monthlySelected = 'button[id$="~Kmonthly"] .hp-selected-box';

for (const [name, html, expected] of [
  [
    'clicks Pay annually when monthly is selected',
    nhiPagesHtml(quotePageHtml + paymentSelectorHtml('monthly'), {}),
    { annual: 1, monthly: 0, log: /NHI: selecting Pay annually\./ }
  ],
  [
    'leaves Pay annually alone when it is already selected',
    // Clicking would swap the selection back to monthly, so a click would fail this test.
    `${quotePageHtml}${paymentSelectorHtml('annually')}<script>
      document.addEventListener('click', () => { document.body.innerHTML = ${JSON.stringify(paymentSelectorHtml('monthly'))}; });
    </script>`,
    { annual: 1, monthly: 0, log: undefined }
  ],
  [
    'skips a quote page without a payment selector',
    quotePageHtml,
    { annual: 0, monthly: 0, log: /NHI: no payment selector on the quote page/ }
  ],
  [
    'fails when Pay annually does not become selected',
    quotePageHtml + paymentSelectorHtml('monthly'),
    { error: /NHI: Pay annually was clicked but did not become selected/ }
  ]
]) {
  test(`annual payment ${name}`, async () => {
    // arrange
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const browser = await chromium.launch();
    const logs = [];
    const log = console.log;
    console.log = (message) => logs.push(String(message));
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(1000);
      await page.goto(`http://127.0.0.1:${server.address().port}`);

      // act
      const selection = selectAnnualPayment(page, 'NHI');

      // assert
      if (expected.error !== undefined) {
        await assert.rejects(selection, expected.error);
        return;
      }

      await selection;
      assert.equal(await page.locator(annualSelected).count(), expected.annual);
      assert.equal(await page.locator(monthlySelected).count(), expected.monthly);
      if (expected.log === undefined) {
        assert.deepEqual(logs, []);
      } else {
        assert.match(logs.join('\n'), expected.log);
      }
    } finally {
      console.log = log;
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
