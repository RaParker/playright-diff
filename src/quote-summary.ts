import type { Page } from 'playwright';
import { color } from './color.js';
import { errorSummaryError, fixJourneyError } from './journey-fixes.js';
import { extendWhileLoading } from './screenshot.js';
import { readErrorSummary } from './tcas-quote.js';

/**
 * Heading shown on the quote page (a quote, a conditional quote, or an estimated quote for a referral, which still
 * shows a price), for any customer name and apostrophe style.
 */
export const quoteHeadingPattern =
  "^Welcome\\s+.*?,\\s*here['’‘ʼ]s\\s+your\\s+(?:(?:conditional|estimated)\\s+)?quote\\s*$";
const errorSelector = 'div.av-card-error-summary';
const seenErrorAttribute = 'data-quote-summary-seen';

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
/**
 * Clicked on the section the journey returns to when it rejects test data (such as a cover start date out of range),
 * once the data has been fixed (see {@link fixJourneyError}). Its name is replaced by the fixed section's.
 */
const returnToQuote: QuoteStep = {
  name: 'journey',
  selector: 'button.hp-submit-form',
  button: 'Return to quote'
};
/** Upper bound on clicks, so pages that keep leading to each other cannot loop until the timeout. */
const maxClicks = 5;

/**
 * Builds a capture step that moves a quote summary on to its quote page. The quote summary already shows a price and
 * the assumptions page asks the customer to confirm them, but the quote page only appears after clicking through them
 * (see {@link quoteSteps}). A page already showing the quote is left as it is. If a click returns to the journey with
 * test data it rejects (see {@link fixJourneyError}), each error is fixed once and Return to quote is clicked (see
 * {@link returnToQuote}).
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes logs and errors.
 * @returns A `beforeCapture` step for a page opened on a quote summary.
 * The step throws when a click leads to any other error summary (or an error already fixed once), the quote is not
 * reached within {@link maxClicks} clicks, or the quote page does not appear before the timeout. An error summary on a
 * journey section or the assumptions page throws a `ValidationError` (see {@link errorSummaryError}).
 */
export function quoteSummary(label: string): (page: Page) => Promise<void> {
  return async (page) => {
    let clicked: QuoteStep | undefined;
    const fixed = new Set<string>();
    for (let clicks = 0; ; clicks++) {
      const outcome = await waitForClickResult(page, label, clicked);
      if (outcome === 'quote') {
        return;
      }

      let step = quoteSteps.find(({ name }) => name === outcome);
      // Logs name a journey section as its heading reads, like the journey fix logs; errors keep the lower case name.
      let shownOn = step?.name ?? '';
      if (step === undefined) {
        const errors = await readErrorSummary(page, errorSelector);
        const section = await fixJourneyError(page, label, errors, fixed);
        if (section === undefined) {
          throw await errorSummaryError(page, `${label} ${clicked?.name ?? 'quote'} errors: ${errors}`);
        }

        step = { ...returnToQuote, name: section.toLowerCase() };
        shownOn = section;
      }

      if (clicks === maxClicks) {
        throw new Error(`${label} quote did not appear within ${maxClicks} clicks; last shown: ${step.name}.`);
      }

      console.log(color.Gray(`${label}: clicking ${step.button} on ${shownOn}.`));
      // Mark summaries already shown, so only a new one counts as the click's error.
      await page.evaluate(
        ({ errorSelector, seenErrorAttribute }) =>
          document.querySelectorAll(errorSelector).forEach((element) => element.setAttribute(seenErrorAttribute, '')),
        { errorSelector, seenErrorAttribute }
      );
      await page.locator(step.selector).click();
      clicked = step;
    }
  };
}

/**
 * Waits for {@link waitForPage}, reporting an error summary that stays on screen after a click until the wait times out
 * (for example a cover start date still out of range after Return to quote).
 */
async function waitForClickResult(page: Page, label: string, clicked: QuoteStep | undefined): Promise<string> {
  try {
    return await waitForPage(page, clicked?.selector);
  } catch (error) {
    const errors = clicked === undefined ? undefined : await readErrorSummary(page, errorSelector);
    if (clicked === undefined || errors === undefined) {
      throw error;
    }

    throw await errorSummaryError(page, `${label} ${clicked.name} errors: ${errors}`, error);
  }
}

/**
 * Waits for the quote heading, a visible {@link quoteSteps} button other than the one just clicked, or (after a
 * click) an error summary not shown before the click.
 * @param page Page to watch.
 * @param clickedSelector Button just clicked, which is ignored so a page that has not moved on yet is not re-clicked.
 * @returns `'quote'`, `'error'`, or the name of the step whose button is shown.
 */
async function waitForPage(page: Page, clickedSelector: string | undefined): Promise<string> {
  const handle = await extendWhileLoading(page, () =>
    page.waitForFunction(
      ({ clickedSelector, quoteHeadingPattern, quoteSteps, errorSelector, seenErrorAttribute }) => {
        if (
          [...document.querySelectorAll('h2')].some(
            (element) =>
              new RegExp(quoteHeadingPattern, 'i').test(element.textContent?.trim() ?? '') &&
              element.getClientRects().length > 0
          )
        ) {
          return 'quote';
        }

        if (
          clickedSelector !== undefined &&
          document.querySelector(`${errorSelector}:not([${seenErrorAttribute}])`) !== null
        ) {
          return 'error';
        }

        const shown = quoteSteps.find(({ selector }) => {
          const button = document.querySelector(selector);
          return selector !== clickedSelector && button !== null && button.getClientRects().length > 0;
        });
        return shown?.name ?? false;
      },
      { clickedSelector, quoteHeadingPattern, quoteSteps, errorSelector, seenErrorAttribute }
    )
  );
  return String(await handle.jsonValue());
}
