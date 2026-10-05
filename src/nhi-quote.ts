import type { Page } from 'playwright';
import { color } from './color.js';
import { readErrorSummary } from './tcas-quote.js';

/** Heading shown on the quote page, for any customer name and apostrophe style. */
export const quoteHeadingPattern = "^Welcome\\s+.*?,\\s*here['’‘ʼ]s\\s+your\\s+quote\\s*$";
const errorSelector = 'div.av-card-error-summary';
const continueSelector = 'button, a, [role="button"]';
const continuePattern = '^Continue with quote$';

/**
 * Moves an NHI quote summary page on to its quote page. The summary already shows a price, but the quote page only
 * appears after clicking Continue with quote. A page already showing the quote is left as it is.
 * @param page Page opened on the NHI quote summary.
 * @throws When Continue with quote leads to an error summary, or the quote page does not appear before the timeout.
 */
export async function nhiQuote(page: Page): Promise<void> {
  if ((await waitForPage(page, false)) === 'quote') {
    return;
  }

  console.log(color.Gray('NHI: quote summary: clicking Continue with quote.'));
  await page
    .locator(continueSelector)
    .filter({ hasText: new RegExp(continuePattern, 'i') })
    .first()
    .click();
  if ((await waitForPage(page, true)) === 'error') {
    throw new Error(`NHI quote summary errors: ${await readErrorSummary(page, errorSelector)}`);
  }
}

/**
 * Waits for the quote heading, or (before the click) the Continue with quote button, or (after it) an error summary.
 * @returns `'quote'`, `'summary'` or `'error'`.
 */
async function waitForPage(page: Page, clicked: boolean): Promise<string> {
  const handle = await page.waitForFunction(
    ({ clicked, quoteHeadingPattern, continueSelector, continuePattern, errorSelector }) => {
      // No named helper functions here: tsx wraps them in __name(), which does not exist in the browser.
      const targets: [string, string][] = [
        ['h2', quoteHeadingPattern],
        [continueSelector, continuePattern]
      ];
      const [quoteShown, continueShown] = targets.map(([selector, pattern]) =>
        [...document.querySelectorAll(selector)].some(
          (element) =>
            new RegExp(pattern, 'i').test(element.textContent?.trim() ?? '') && element.getClientRects().length > 0
        )
      );
      if (quoteShown === true) {
        return 'quote';
      }

      if (clicked) {
        return document.querySelector(errorSelector) !== null ? 'error' : false;
      }

      return continueShown === true ? 'summary' : false;
    },
    { clicked, quoteHeadingPattern, continueSelector, continuePattern, errorSelector }
  );
  return String(await handle.jsonValue());
}
