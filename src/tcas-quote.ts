import type { Locator, Page } from 'playwright';
import { trackApiRequests, type ApiRequests } from './api-requests.js';
import { color } from './color.js';
import { errorSummaryError, fixJourneyError } from './journey-fixes.js';
import { DeclinedError, extendWhileLoading, OopsError, UnexpectedPageError, ValidationError } from './screenshot.js';
import steps from './tcas-quote.steps.json' with { type: 'json' };

export async function tcasQuote(page: Page): Promise<void> {
  const apiRequests = trackApiRequests(page);
  for (const [index, step] of steps.entries()) {
    const started = performance.now();
    try {
      await runStep(page, apiRequests, step);
      console.log(
        color.Gray(`TCAS step ${index + 1} (${step.action}) passed in ${Math.round(performance.now() - started)} ms`)
      );
    } catch (error) {
      throw stepError(`TCAS step ${index + 1} (${step.action})`, error);
    }
  }
}

/**
 * Reads the page's error summary, if one is shown.
 * @param page Page to check.
 * @param errorSelector Error summary selector.
 * @returns Each `ul > li > a` link's text on its own line (or the whole summary's text when it has no links),
 * `(empty error summary)` when the summary has no text, or `undefined` when no summary is shown.
 */
export async function readErrorSummary(page: Page, errorSelector: string): Promise<string | undefined> {
  const errors = page.locator(errorSelector);
  if ((await errors.count()) === 0) {
    return undefined;
  }

  const links = errors.locator(':scope > ul > li > a');
  const messages = await ((await links.count()) > 0 ? links : errors).allTextContents();
  const text = messages.map((message) => message.trim()).join('\n');
  return text.length > 0 ? text : '(empty error summary)';
}

/**
 * Names the failed step in its error. Oops and declines pass through unchanged (they name the page, not the step), and
 * the other error classes callers act on are kept.
 */
function stepError(step: string, error: unknown): unknown {
  if (error instanceof OopsError || error instanceof DeclinedError) {
    return error;
  }

  const message = `${step} failed: ${error instanceof Error ? error.message : String(error)}`;
  if (error instanceof ValidationError) {
    return new ValidationError(message, { cause: error });
  }

  return error instanceof UnexpectedPageError
    ? new UnexpectedPageError(message, { cause: error })
    : new Error(message, { cause: error });
}

interface Step {
  action: string;
  selector: string;
  text?: string;
  textPattern?: string;
  errorSelector?: string;
  recoverJourneyErrors?: boolean;
}

async function runStep(page: Page, apiRequests: ApiRequests, step: Step): Promise<void> {
  const locator = page.locator(step.selector);
  const target =
    step.text === undefined
      ? locator
      : locator.filter({
          hasText: new RegExp(`^${step.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
        });
  switch (step.action) {
    case 'wait':
      await target.waitFor({ state: 'visible' });
      return;
    case 'click':
      await clickAndRecover(page, apiRequests, target, step.text ?? step.selector, step.recoverJourneyErrors === true);
      return;
    case 'waitForQuote':
      if (step.textPattern === undefined || step.errorSelector === undefined) {
        throw new Error('Quote step requires textPattern and errorSelector.');
      }

      await waitForQuote(page, step.selector, step.textPattern, step.errorSelector);
      return;
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

/**
 * Clicks `target` and checks for errors once the work the click started has finished (see {@link clickAndSettle}). With
 * `recover`, test data the journey rejects is fixed (each error once, see {@link fixJourneyError}) and `target` (logged
 * as `name`) is clicked again, until no errors remain or none can be fixed.
 */
async function clickAndRecover(
  page: Page,
  apiRequests: ApiRequests,
  target: Locator,
  name: string,
  recover: boolean
): Promise<void> {
  const fixed = new Set<string>();
  await clickAndSettle(page, apiRequests, target);
  for (;;) {
    // The summary itself is passed to the fixes, so the changes they record quote its lines without this flow's heading.
    const errors = await readErrorSummary(page, 'div.av-card-error-summary');
    if (errors === undefined) {
      return;
    }

    if (!recover || (await fixJourneyError(page, 'TCAS', errors, fixed)) === undefined) {
      throw await quoteErrorsError(page, errors);
    }

    console.log(color.Gray(`TCAS: clicking ${name} again.`));
    await clickAndSettle(page, apiRequests, target);
  }
}

/**
 * Clicks `target` and waits for the page's API requests to settle. The site can show an error summary only after a
 * server-side check, and can leave the previous summary on screen for a moment after a re-click, so the summary is
 * only read once the page has finished responding.
 */
async function clickAndSettle(page: Page, apiRequests: ApiRequests, target: Locator): Promise<void> {
  await target.click();
  await apiRequests.settled();
}

async function waitForQuote(page: Page, selector: string, textPattern: string, errorSelector: string): Promise<void> {
  // Submission may render errors asynchronously. Wait for either outcome,
  // giving errors priority if the page contains both.
  await extendWhileLoading(page, () =>
    page.waitForFunction(
      ({ selector, textPattern, errorSelector }) => {
        if (document.querySelector(errorSelector) !== null) {
          return true;
        }

        return [...document.querySelectorAll(selector)].some(
          (heading) =>
            new RegExp(textPattern, 'i').test(heading.textContent?.trim() ?? '') && heading.getClientRects().length > 0
        );
      },
      { selector, textPattern, errorSelector }
    )
  );

  await checkQuoteErrors(page, errorSelector);
}

async function checkQuoteErrors(page: Page, errorSelector: string): Promise<void> {
  const errors = await readErrorSummary(page, errorSelector);
  if (errors !== undefined) {
    throw await quoteErrorsError(page, errors);
  }
}

function quoteErrorsError(page: Page, errors: string): Promise<Error> {
  return errorSummaryError(page, `TCAS quote errors: ${errors}`);
}
