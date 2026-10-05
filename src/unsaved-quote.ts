import type { Page, Request } from 'playwright';
import { color } from './color.js';
import { readErrorSummary } from './tcas-quote.js';

const errorSelector = 'div.av-card-error-summary';
const quoteHeadingPattern = "^Welcome\\s+.*?,\\s*here['’‘ʼ]s\\s+your\\s+quote\\s*$";
/** Upper bound on sections walked, so a journey that never offers Get your quote cannot loop forever. */
const maxSections = 15;
/**
 * Get your quote can return to a section whose lookups had not finished (e.g. the rebuild estimate); the journey
 * is walked again once after that, so a second return is reported.
 */
const maxReturns = 1;
const apiQuietMilliseconds = 500;
const apiSettleLimitMilliseconds = 10000;
const seenErrorAttribute = 'data-unsaved-quote-seen';
/** Text shown while a section looks up details; its answers are incomplete until it disappears. */
const lookupInProgressPattern = /^Checking property details$/i;

/**
 * Drives an unsaved quote journey (opened with `nhi=false`) to its quote page, which saves the quote to NHI.
 * Clicks Continue through each section until Get your quote appears, clicks it, and waits for the quote heading.
 * If Get your quote returns to a section, that section's lookups are waited for and the journey is walked again.
 * @param page Page opened on the journey.
 * @throws When Continue leaves an error summary on a section, Get your quote returns to a section more than
 * {@link maxReturns} time(s), or Get your quote is not reached within the section limit. Errors name the section
 * and include the summary text.
 */
export async function unsavedQuote(page: Page): Promise<void> {
  const apiRequests = trackApiRequests(page);
  const quoteButton = page.locator('button').filter({ hasText: /^Get your quote$/ });
  let returns = 0;
  for (let step = 0; step < maxSections; step++) {
    const section = await readSection(page);
    // Lookups started by a section (e.g. the rebuild estimate) must finish before moving on.
    await waitForLookups(page, apiRequests);
    if (await quoteButton.isVisible()) {
      console.log(color.Gray(`NHI journey: ${section}: clicking Get your quote.`));
      await quoteButton.click();
      if (await waitForQuote(page, section)) {
        return;
      }

      const returnedTo = await readSection(page);
      if (++returns > maxReturns) {
        const errors = await readErrorSummary(page, errorSelector);
        throw new Error(
          `NHI journey returned to ${returnedTo} after Get your quote ${returns} times${errors === undefined ? '' : `: ${errors}`}`
        );
      }

      console.log(color.Gray(`NHI journey: Get your quote returned to ${returnedTo}; walking the journey again.`));
      continue;
    }

    console.log(color.Gray(`NHI journey: ${section}: clicking Continue.`));
    await continueFrom(page, section);
  }

  throw new Error(`NHI journey did not reach Get your quote within ${maxSections} sections.`);
}

async function readSection(page: Page): Promise<string> {
  const heading = page.locator('h1').first();
  await heading.waitFor({ state: 'visible' });
  return (await heading.textContent())?.trim() ?? '';
}

async function waitForLookups(page: Page, apiRequests: { settled: () => Promise<void> }): Promise<void> {
  await apiRequests.settled();
  await page.getByText(lookupInProgressPattern).first().waitFor({ state: 'hidden' });
}

/**
 * Waits for the quote heading, or for the journey to return to a section (shown by a section heading or an error
 * summary).
 * @returns `true` when the quote is shown, `false` when the journey returned to a section.
 */
async function waitForQuote(page: Page, section: string): Promise<boolean> {
  const quoteHeading = await page.waitForFunction(
    ({ section, errorSelector, quoteHeadingPattern }) => {
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
        document.querySelector(errorSelector) !== null ||
        (heading !== null && heading.getClientRects().length > 0 && heading.textContent?.trim() !== section);
      return returned ? 'returned' : false;
    },
    { section, errorSelector, quoteHeadingPattern }
  );
  return (await quoteHeading.jsonValue()) === 'quote';
}

async function continueFrom(page: Page, section: string): Promise<void> {
  // Mark summaries already shown, so only a new one (or the heading changing) ends the wait.
  await page.evaluate(
    ({ errorSelector, seenErrorAttribute }) =>
      document.querySelectorAll(errorSelector).forEach((element) => element.setAttribute(seenErrorAttribute, '')),
    { errorSelector, seenErrorAttribute }
  );
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
    await throwOnErrorSummary(page, section);
    throw error;
  }

  if (outcome !== 'moved') {
    await throwOnErrorSummary(page, section);
  }
}

async function throwOnErrorSummary(page: Page, section: string): Promise<void> {
  const errors = await readErrorSummary(page, errorSelector);
  if (errors !== undefined) {
    throw new Error(`NHI journey validation failed on ${section}: ${errors}`);
  }
}

function trackApiRequests(page: Page): { settled: () => Promise<void> } {
  const origin = new URL(page.url()).origin;
  const pending = new Set<Request>();
  const isApi = (request: Request) => {
    const url = new URL(request.url());
    return url.origin === origin && url.pathname.startsWith('/api/');
  };

  page.on('request', (request) => {
    if (isApi(request)) {
      pending.add(request);
    }
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => pending.delete(request));
  return {
    settled: async () => {
      // Proceed after the limit regardless, so a polling endpoint cannot stall the journey.
      const started = performance.now();
      let quietSince = performance.now();
      while (performance.now() - started < apiSettleLimitMilliseconds) {
        if (pending.size > 0) {
          quietSince = performance.now();
        } else if (performance.now() - quietSince >= apiQuietMilliseconds) {
          return;
        }

        await page.waitForTimeout(100);
      }
    }
  };
}
