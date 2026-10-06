import type { Page } from 'playwright';
import { color } from './color.js';
import { fixCoverStart } from './cover-start.js';
import { extendWhileLoading } from './screenshot.js';
import steps from './tcas-quote.steps.json' with { type: 'json' };

export async function tcasQuote(page: Page): Promise<void> {
  for (const [index, step] of steps.entries()) {
    const started = performance.now();
    try {
      await runStep(page, step);
      console.log(
        color.Gray(`TCAS step ${index + 1} (${step.action}) passed in ${Math.round(performance.now() - started)} ms`)
      );
    } catch (error) {
      throw new Error(
        `TCAS step ${index + 1} (${step.action}) failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
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

interface Step {
  action: string;
  selector: string;
  text?: string;
  textPattern?: string;
  errorSelector?: string;
  recoverCoverStart?: boolean;
}

async function runStep(page: Page, step: Step): Promise<void> {
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
      await target.click();
      try {
        await checkQuoteErrors(page, 'div.av-card-error-summary');
      } catch (error) {
        if (
          step.recoverCoverStart !== true ||
          !(await fixCoverStart(page, 'TCAS', error instanceof Error ? error.message : undefined))
        ) {
          throw error;
        }

        await target.click();
        await checkQuoteErrors(page, 'div.av-card-error-summary');
      }

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
    throw new Error(`TCAS quote errors: ${errors}`);
  }
}
