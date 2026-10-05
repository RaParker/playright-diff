import type { Page } from 'playwright';
import { color } from './color.js';
import { readErrorSummary } from './tcas-quote.js';

/** Heading shown on the quote page, for any customer name and apostrophe style. */
export const quoteHeadingPattern = "^Welcome\\s+.*?,\\s*here['’‘ʼ]s\\s+your\\s+quote\\s*$";
const errorSelector = 'div.av-card-error-summary';

interface QuoteStep {
  /** Page name used in logs and errors. */
  name: string;
  /** Button that moves the page on towards the quote. */
  selector: string;
  /** Button text, for logs. */
  button: string;
}

/** Pages a quote summary can show before the quote, in any order; each is clicked through when it appears. */
const quoteSteps: QuoteStep[] = [
  { name: 'quote summary', selector: 'button#hp-summary-continue-button', button: 'Continue with quote' },
  { name: 'assumptions', selector: 'button#hp-assumptions-quote-button', button: 'Yes, take me to my quote' }
];
/** Upper bound on clicks, so pages that keep leading to each other cannot loop until the timeout. */
const maxClicks = 5;

/**
 * Builds a capture step that moves a quote summary on to its quote page. The quote summary already shows a price and
 * the assumptions page asks the customer to confirm them, but the quote page only appears after clicking through them
 * (see {@link quoteSteps}). A page already showing the quote is left as it is.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes logs and errors.
 * @returns A `beforeCapture` step for a page opened on a quote summary.
 * The step throws when a click leads to an error summary, the quote is not reached within {@link maxClicks} clicks,
 * or the quote page does not appear before the timeout.
 */
export function quoteSummary(label: string): (page: Page) => Promise<void> {
  return async (page) => {
    let clicked: QuoteStep | undefined;
    for (let clicks = 0; ; clicks++) {
      const outcome = await waitForPage(page, clicked?.selector);
      if (outcome === 'quote') {
        return;
      }

      const step = quoteSteps.find(({ name }) => name === outcome);
      if (step === undefined) {
        throw new Error(`${label} ${clicked?.name ?? 'quote'} errors: ${await readErrorSummary(page, errorSelector)}`);
      }

      if (clicks === maxClicks) {
        throw new Error(`${label} quote did not appear within ${maxClicks} clicks; last shown: ${step.name}.`);
      }

      console.log(color.Gray(`${label}: ${step.name}: clicking ${step.button}.`));
      await page.locator(step.selector).click();
      clicked = step;
    }
  };
}

/**
 * Waits for the quote heading, a visible {@link quoteSteps} button other than the one just clicked, or (after a
 * click) an error summary.
 * @param page Page to watch.
 * @param clickedSelector Button just clicked, which is ignored so a page that has not moved on yet is not re-clicked.
 * @returns `'quote'`, `'error'`, or the name of the step whose button is shown.
 */
async function waitForPage(page: Page, clickedSelector: string | undefined): Promise<string> {
  const handle = await page.waitForFunction(
    ({ clickedSelector, quoteHeadingPattern, quoteSteps, errorSelector }) => {
      if (
        [...document.querySelectorAll('h2')].some(
          (element) =>
            new RegExp(quoteHeadingPattern, 'i').test(element.textContent?.trim() ?? '') &&
            element.getClientRects().length > 0
        )
      ) {
        return 'quote';
      }

      if (clickedSelector !== undefined && document.querySelector(errorSelector) !== null) {
        return 'error';
      }

      const shown = quoteSteps.find(({ selector }) => {
        const button = document.querySelector(selector);
        return selector !== clickedSelector && button !== null && button.getClientRects().length > 0;
      });
      return shown?.name ?? false;
    },
    { clickedSelector, quoteHeadingPattern, quoteSteps, errorSelector }
  );
  return String(await handle.jsonValue());
}
