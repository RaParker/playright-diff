import type { Page } from 'playwright';
import { recordAnswerChange } from './answer-changes.js';
import { color } from './color.js';
import { errorSummaryError, exactText, fixJourneyError, journeyTimelineSelector } from './journey-fixes.js';
import { quoteHeadingPattern } from './quote-endpoint.js';
import { extendWhileLoading } from './screenshot.js';
import { joinErrorLines, readErrorSummary } from './tcas-quote.js';

export { quoteHeadingPattern } from './quote-endpoint.js';

const errorSelector = 'div.av-card-error-summary';
const seenErrorAttribute = 'data-quote-summary-seen';

interface QuoteStep {
  /** Page name used in logs and errors. */
  name: string;
  /** Button that moves the page on towards the quote. */
  selector: string;
  /** Button text, for logs. */
  button: string;
  /** Checkbox ticked (by clicking its label) before the button is clicked, when it is not already ticked. */
  confirm?: { selector: string; label: string };
}

/**
 * Pages a quote summary can show before the quote, in any order; each is clicked through when it appears. The
 * assumptions page has two layouts, both still served: one with Yes, take me to my quote, and one where the customer
 * ticks that the assumptions are correct and clicks Continue.
 */
const quoteSteps: QuoteStep[] = [
  { name: 'quote summary', selector: 'button#hp-summary-continue-button', button: 'Continue with quote' },
  { name: 'assumptions', selector: 'button#hp-assumptions-quote-button', button: 'Yes, take me to my quote' },
  {
    name: 'assumptions',
    selector: '#hp-assumptions-button-group button.hp-submit-form',
    button: 'Continue',
    confirm: {
      selector: '#hp-assumptions-button-group input[name="areAssumptionsAcknowledged"]',
      label: 'All assumptions and answers above are correct'
    }
  }
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
/** Journey section {@link requote} opens from the quote page's timeline: the last one, so it needs no answers. */
const requoteSection = 'Contact details';
/** Journey section holding the cover type question, opened by {@link selectBuildingsAndContents}. */
const coverDetailsSection = 'Cover details';
/** The cover type image radio list's options, as their captions read. */
const coverTypeOptions = { both: 'Buildings & Contents', single: ['Buildings only', 'Contents only'] };
/** Question name the cover type change is recorded under (see {@link recordAnswerChange}). */
const coverTypeQuestion = 'cover type';

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
  return (page) => followToQuote(page, label, undefined);
}

/**
 * Builds a capture step that re-quotes a quote page through the journey: it opens {@link requoteSection} from the
 * timeline and clicks Return to quote, which posts the answers to `/api/save-details` even when none changed. For a TCAS
 * quote that prices the answers through QuoteJourneyService and the Policy API, as a customer's Return to quote would,
 * so differences that only appear after a re-quote are captured. The page then follows {@link quoteSummary} to the quote.
 * @param label Flow name (e.g. `TCAS`) that prefixes logs and errors.
 * @returns A `beforeCapture` step for a page already showing the quote.
 * The step throws as {@link quoteSummary} does, or when the section does not open before the timeout.
 */
export function requote(label: string): (page: Page) => Promise<void> {
  return async (page) => {
    console.log(color.Gray(`${label}: opening ${requoteSection} to re-quote.`));
    await openTimelineSection(page, requoteSection);
    await returnToQuoteFrom(page, label, requoteSection);
  };
}

/**
 * Builds a capture step that re-quotes a quote page with the cover type Buildings & Contents: it opens
 * {@link coverDetailsSection} from the timeline and reads the cover type image radio list's ticked option. Buildings only
 * or Contents only is changed to Buildings & Contents and recorded as an answer change (see {@link recordAnswerChange});
 * Buildings & Contents (or no ticked option) is left as it is and records nothing. Either way it then clicks Return to
 * quote and follows {@link quoteSummary} to the quote, fixing any journey errors the change leads to.
 * @param label Flow name (e.g. `NHI`) that prefixes logs and errors.
 * @param reason Why the cover type is changed, recorded as the change's error.
 * @returns A `beforeCapture` step for a page already showing the quote.
 * The step throws as {@link quoteSummary} does, or when the section or the cover type question does not appear before
 * the timeout.
 */
export function selectBuildingsAndContents(label: string, reason: string): (page: Page) => Promise<void> {
  return async (page) => {
    console.log(color.Gray(`${label}: opening ${coverDetailsSection} to re-check the cover type.`));
    await openTimelineSection(page, coverDetailsSection);
    const question = page
      .locator('div.hp-float')
      .filter({ has: page.locator('label', { hasText: exactText(coverTypeOptions.both) }) });
    await question.first().waitFor({ state: 'visible' });
    const ticked = await question
      .first()
      .locator('label.hp-checked')
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
    const before = ticked[0] ?? null;
    if (before !== null && coverTypeOptions.single.includes(before)) {
      console.log(
        color.Gray(`${label}: selecting ${coverTypeQuestion} ${coverTypeOptions.both} on ${coverDetailsSection}.`)
      );
      await question
        .first()
        .locator('label')
        .filter({ hasText: exactText(coverTypeOptions.both) })
        .click();
      recordAnswerChange(label, coverDetailsSection, {
        question: coverTypeQuestion,
        before,
        after: coverTypeOptions.both,
        error: reason
      });
    } else {
      console.log(color.Gray(`${label}: ${coverTypeQuestion} is ${before ?? 'not selected'}; leaving it as it is.`));
    }

    await returnToQuoteFrom(page, label, coverDetailsSection);
  };
}

/**
 * Clicks through {@link quoteSteps} until the quote appears, fixing journey errors once each (see
 * {@link fixJourneyError}).
 * @param clicked Step already clicked, whose page is ignored and whose errors are reported, or `undefined`.
 * @throws As {@link quoteSummary}.
 */
async function followToQuote(page: Page, label: string, clicked: QuoteStep | undefined): Promise<void> {
  const fixed = new Set<string>();
  for (let clicks = 0; ; clicks++) {
    const outcome = await waitForClickResult(page, clicked);
    if (outcome === 'quote') {
      return;
    }

    let step = quoteSteps.find(({ selector }) => selector === outcome);
    // Logs name a journey section as its heading reads, like the journey fix logs; errors keep the lower case name.
    let shownOn = step?.name ?? '';
    if (step === undefined) {
      const errors = await readErrorSummary(page, errorSelector);
      const section = await fixJourneyError(page, label, errors, fixed);
      if (section === undefined) {
        throw await errorSummaryError(page, await describeErrorSummary(page, clicked, errors));
      }

      step = { ...returnToQuote, name: section.toLowerCase() };
      shownOn = section;
    }

    if (clicks === maxClicks) {
      throw new Error(`${label} quote did not appear within ${maxClicks} clicks; last shown: ${step.name}.`);
    }

    await clickStep(page, label, step, shownOn);
    clicked = step;
  }
}

/** Opens a journey section from the quote page's timeline and waits for its heading. */
async function openTimelineSection(page: Page, section: string): Promise<void> {
  await page.locator(`div.av-timeline-all-sections > ul > li[title="${section}"]`).click();
  await extendWhileLoading(page, () =>
    page.waitForFunction((heading) => document.querySelector('h1')?.textContent?.trim() === heading, section)
  );
}

/** Clicks Return to quote on a journey section, then follows the pages on to the quote (see {@link followToQuote}). */
async function returnToQuoteFrom(page: Page, label: string, section: string): Promise<void> {
  const step = { ...returnToQuote, name: section.toLowerCase() };
  await clickStep(page, label, step, section);
  await followToQuote(page, label, step);
}

/**
 * Logs and clicks a step's button, first ticking its confirmation checkbox if it has one, and marking error summaries
 * already shown so only a new one counts. The button is matched by its text as well as its selector, since a journey
 * section can show several submit buttons (Contact details has both Get your quote and Return to quote).
 */
async function clickStep(page: Page, label: string, step: QuoteStep, shownOn: string): Promise<void> {
  if (step.confirm !== undefined) {
    await tickConfirmation(page, label, step.confirm);
  }

  console.log(color.Gray(`${label}: clicking ${step.button} on ${shownOn}.`));
  await page.evaluate(
    ({ errorSelector, seenErrorAttribute }) =>
      document.querySelectorAll(errorSelector).forEach((element) => element.setAttribute(seenErrorAttribute, '')),
    { errorSelector, seenErrorAttribute }
  );
  await page.locator(step.selector).filter({ hasText: step.button }).click();
}

/**
 * Ticks a confirmation checkbox unless it is already ticked, by clicking its label: the site styles the label as the
 * checkbox, so the input itself may not be clickable.
 */
async function tickConfirmation(
  page: Page,
  label: string,
  confirm: { selector: string; label: string }
): Promise<void> {
  const checkbox = page.locator(confirm.selector).first();
  if (await checkbox.isChecked()) {
    return;
  }

  console.log(color.Gray(`${label}: ticking ${confirm.label}.`));
  // Found by its text, so it works whether the label is linked to the input by id or holds it
  await page
    .locator('label')
    .filter({ hasText: exactText(confirm.label) })
    .click();
}

/**
 * Describes an error summary the flow cannot fix, on one line: where it is shown, the button clicked before it, and its
 * messages (see {@link joinErrorLines}), such as `Contact details errors after Yes, take me to my quote: …`. A journey
 * section (its timeline shown) is named by its heading; other pages by the step's name, since headings such as the
 * quote summary's welcome can hold the customer's name. The flow is left out: the capture's failure names it.
 * @param page Page showing the error summary.
 * @param clicked Step clicked before the errors appeared, or `undefined` when none was.
 * @param errors Error summary text, one message per line, or `undefined` when none is shown.
 * @returns The description.
 */
async function describeErrorSummary(
  page: Page,
  clicked: QuoteStep | undefined,
  errors: string | undefined
): Promise<string> {
  const onJourney = await page.locator(journeyTimelineSelector).first().isVisible();
  const heading = onJourney ? (await page.locator('h1').first().textContent())?.trim() : undefined;
  const shownOn = heading !== undefined && heading.length > 0 ? heading : (clicked?.name ?? 'quote');
  const after = clicked === undefined ? '' : ` after ${clicked.button}`;
  return `${shownOn} errors${after}: ${joinErrorLines(errors ?? '')}`;
}

/**
 * Waits for {@link waitForPage}, reporting an error summary that stays on screen after a click until the wait times out
 * (for example a cover start date still out of range after Return to quote).
 */
async function waitForClickResult(page: Page, clicked: QuoteStep | undefined): Promise<string> {
  try {
    return await waitForPage(page, clicked?.selector);
  } catch (error) {
    const errors = clicked === undefined ? undefined : await readErrorSummary(page, errorSelector);
    if (clicked === undefined || errors === undefined) {
      throw error;
    }

    throw await errorSummaryError(page, await describeErrorSummary(page, clicked, errors), error);
  }
}

/**
 * Waits for the quote heading, a visible {@link quoteSteps} button other than the one just clicked, or (after a
 * click) an error summary not shown before the click.
 * @param page Page to watch.
 * @param clickedSelector Button just clicked, which is ignored so a page that has not moved on yet is not re-clicked.
 * @returns `'quote'`, `'error'`, or the selector of the step whose button is shown (steps can share a name).
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
        return shown?.selector ?? false;
      },
      { clickedSelector, quoteHeadingPattern, quoteSteps, errorSelector, seenErrorAttribute }
    )
  );
  return String(await handle.jsonValue());
}
