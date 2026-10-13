import type { Page } from 'playwright';
import { trackApiRequests, type ApiRequests } from './api-requests.js';
import { color } from './color.js';
import { fixJourneyError, rebuildingCostFixName } from './journey-fixes.js';
import { quoteHeadingPattern } from './quote-summary.js';
import { extendWhileLoading, UnexpectedPageError, ValidationError } from './screenshot.js';
import { readErrorSummary } from './tcas-quote.js';

const errorSelector = 'div.av-card-error-summary';
/**
 * Upper bound on sections walked, so a journey that never offers Get your quote cannot loop forever. Sections walked
 * again after a fix or a return count too, so this allows for several walks of the whole journey.
 */
const maxSections = 40;
/**
 * Get your quote can return to a section whose lookups had not finished (e.g. the rebuild estimate); the journey
 * is walked again once after that, so a second return is reported.
 */
const maxReturns = 1;
const seenErrorAttribute = 'data-unsaved-quote-seen';
/** Text shown while a section looks up details; its answers are incomplete until it disappears. */
const lookupInProgressPattern = /^Checking property details$/i;

/**
 * Drives an unsaved quote journey (opened with `nhi=false`) to its quote page, which saves the quote to NHI.
 * Clicks Continue through each section until Get your quote appears, clicks it, and waits for the quote heading.
 * If Get your quote returns to a section, that section's lookups are waited for and the journey is walked again.
 * Test data the journey rejects (reported by Continue or by a return), such as a cover start date out of range or an
 * invalid email address, is fixed once (see {@link fixJourneyError}) and the journey is walked again from there. The
 * rebuilding cost can be fixed once more after each return that is not fixed, as the site can drop the saved cost.
 * @param page Page opened on the journey.
 * @throws A {@link ValidationError} when Continue leaves any other error summary (or an error already fixed once) on a
 * section, or Get your quote returns to a section more than {@link maxReturns} time(s); these name the section and
 * include the summary text. An `Error` when Get your quote is not reached within the section limit.
 */
export async function unsavedQuote(page: Page): Promise<void> {
  const apiRequests = trackApiRequests(page);
  const quoteButton = page.locator('button').filter({ hasText: /^Get your quote$/ });
  let returns = 0;
  const fixed = new Set<string>();
  for (let step = 0; step < maxSections; step++) {
    const section = await readSection(page);
    // Lookups started by a section (e.g. the rebuild estimate) must finish before moving on.
    await waitForLookups(page, apiRequests);
    if (await quoteButton.isVisible()) {
      console.log(color.Gray(`NHI: clicking Get your quote on ${section}.`));
      await markErrorSummariesSeen(page);
      await quoteButton.click();
      if (await waitForQuote(page, section)) {
        return;
      }

      const returnedTo = await readSection(page);
      const errors = await readErrorSummary(page, errorSelector);
      if ((await fixJourneyError(page, 'NHI', errors, fixed)) !== undefined) {
        console.log(color.Gray(`NHI: Get your quote returned to ${returnedTo}; walking the journey again.`));
        continue;
      }

      if (++returns > maxReturns) {
        throw new ValidationError(
          `NHI journey returned to ${returnedTo} after Get your quote ${returns} times${errors === undefined ? '' : `: ${errors}`}`
        );
      }

      // The site can drop the saved rebuilding cost on a return while its field still shows it, so allow one more fix.
      fixed.delete(rebuildingCostFixName);
      console.log(color.Gray(`NHI: Get your quote returned to ${returnedTo}; walking the journey again.`));
      continue;
    }

    console.log(color.Gray(`NHI: clicking Continue on ${section}.`));
    const errors = await continueFrom(page, section);
    if (errors !== undefined && (await fixJourneyError(page, 'NHI', errors, fixed)) === undefined) {
      throw new ValidationError(`NHI journey validation failed on ${section}: ${errors}`);
    }
  }

  throw new Error(`NHI journey did not reach Get your quote within ${maxSections} sections.`);
}

async function readSection(page: Page): Promise<string> {
  const heading = page.locator('h1').first();
  await heading.waitFor({ state: 'visible' });
  return (await heading.textContent())?.trim() ?? '';
}

async function waitForLookups(page: Page, apiRequests: ApiRequests): Promise<void> {
  await apiRequests.settled();
  await page.getByText(lookupInProgressPattern).first().waitFor({ state: 'hidden' });
}

/**
 * Waits for the quote heading, or for the journey to return to a section (shown by a section heading or an error
 * summary not shown before the click, see {@link markErrorSummariesSeen}).
 * @returns `true` when the quote is shown, `false` when the journey returned to a section.
 */
async function waitForQuote(page: Page, section: string): Promise<boolean> {
  try {
    const quoteHeading = await extendWhileLoading(page, () =>
      page.waitForFunction(
        ({ section, errorSelector, seenErrorAttribute, quoteHeadingPattern }) => {
          // No named helper functions here: tsx wraps them in __name(), which does not exist in the browser.
          if (
            [...document.querySelectorAll('h2')].some(
              (element) =>
                new RegExp(quoteHeadingPattern, 'i').test(element.textContent?.trim() ?? '') &&
                element.getClientRects().length > 0
            )
          ) {
            return 'quote';
          }

          const heading = document.querySelector('h1');
          const returned =
            document.querySelector(`${errorSelector}:not([${seenErrorAttribute}])`) !== null ||
            (heading !== null && heading.getClientRects().length > 0 && heading.textContent?.trim() !== section);
          return returned ? 'returned' : false;
        },
        { section, errorSelector, seenErrorAttribute, quoteHeadingPattern }
      )
    );
    return (await quoteHeading.jsonValue()) === 'quote';
  } catch (error) {
    // A summary the site keeps in place on returning to the same section leaves the page unchanged until the wait times
    // out with no loading screen; a loading screen that does not clear is still reported as a timeout.
    if (!(error instanceof UnexpectedPageError) || (await readErrorSummary(page, errorSelector)) === undefined) {
      throw error;
    }

    return false;
  }
}

/**
 * Clicks Continue and waits for the next section or a new error summary.
 * @returns The error summary text when Continue failed validation, otherwise `undefined`.
 */
async function continueFrom(page: Page, section: string): Promise<string | undefined> {
  await markErrorSummariesSeen(page);
  await page
    .locator('button')
    .filter({ hasText: /^Continue$/i })
    .first()
    .click();
  let outcome: unknown;
  try {
    const handle = await page.waitForFunction(
      ({ section, errorSelector, seenErrorAttribute }) => {
        const heading = document.querySelector('h1');
        if (heading !== null && heading.getClientRects().length > 0 && heading.textContent?.trim() !== section) {
          return 'moved';
        }

        return document.querySelector(`${errorSelector}:not([${seenErrorAttribute}])`) !== null ? 'error' : false;
      },
      { section, errorSelector, seenErrorAttribute }
    );
    outcome = await handle.jsonValue();
  } catch (error) {
    // A summary that stays in place keeps the section on screen until the wait times out.
    const errors = await readErrorSummary(page, errorSelector);
    if (errors === undefined) {
      throw error;
    }

    return errors;
  }

  return outcome === 'moved' ? undefined : readErrorSummary(page, errorSelector);
}

/** Marks the error summaries already shown, so only a new one (or the heading changing) ends a wait after a click. */
async function markErrorSummariesSeen(page: Page): Promise<void> {
  await page.evaluate(
    ({ errorSelector, seenErrorAttribute }) =>
      document.querySelectorAll(errorSelector).forEach((element) => element.setAttribute(seenErrorAttribute, '')),
    { errorSelector, seenErrorAttribute }
  );
}
