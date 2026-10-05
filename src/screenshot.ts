import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium, errors, type Page } from 'playwright';
import { color } from './color.js';

export interface ScreenshotOptions {
  output?: string;
  width?: number;
  height?: number;
  wait?: number;
  timeout?: number;
  beforeCapture?: (page: Page) => Promise<void>;
}

/** Decline heading, e.g. "We're sorry..." or "Welcome Mr. A, we're sorry...", with any apostrophe style. */
const declinedHeadingPattern = "we['’‘ʼ]re\\s+sorry";
/** Decline wording that must also appear, so a stray "we're sorry" heading is not treated as a decline. */
const declinedTextPattern = 'unable\\s+to\\s+offer\\s+you\\s+a\\s+quote';

/** Raised when the page displays an `<h2>Oops</h2>` heading, so callers can tell it apart from other failures. */
export class OopsError extends Error {
  /** @param url Page that displayed Oops, appended to the message when given. */
  constructor(url?: string) {
    super(`Website displayed <h2>Oops</h2>; stopping the journey.${url === undefined ? '' : ` (${url})`}`);
    this.name = 'OopsError';
  }
}

/** Raised when the page shows the "We're sorry… unable to offer you a quote" decline, which is a result, not a fault. */
export class DeclinedError extends Error {
  /** @param url Page that declined the quote, appended to the message when given. */
  constructor(url?: string) {
    super(
      `Website declined the quote ("We're sorry..."); stopping the journey.${url === undefined ? '' : ` (${url})`}`
    );
    this.name = 'DeclinedError';
  }
}

/** Quote loading screens may take longer than other steps, so they get this many times the step timeout. */
const loadingTimeoutMultiplier = 2;
/** Longest wait for each page's quote loading screen to clear. */
const loadingTimeouts = new WeakMap<Page, number>();

/**
 * Runs a wait, and if it times out while a quote loading screen is still shown, waits for the loading screen to clear
 * (up to the rest of the loading allowance, twice the step timeout in all) and runs the wait once more. A timeout
 * with no loading screen is rethrown at once.
 * @param page Page opened by {@link screenshot}.
 * @param wait Wait to run, which should use the page's default timeout.
 * @returns The wait's result.
 * @throws The wait's error, or a loading-screen timeout when the screen does not clear.
 */
export async function extendWhileLoading<T>(page: Page, wait: () => Promise<T>): Promise<T> {
  try {
    return await wait();
  } catch (error) {
    const loadingTimeout = loadingTimeouts.get(page);
    if (!(error instanceof errors.TimeoutError) || loadingTimeout === undefined || !(await isQuoteLoading(page))) {
      throw error;
    }

    const extra = loadingTimeout - loadingTimeout / loadingTimeoutMultiplier;
    console.log(color.Gray(`Loading screen still shown; allowing up to ${Math.round(extra / 1000)} s more.`));
    await waitForQuoteLoading(page, extra);
    return await wait();
  }
}

export async function screenshot(urlArgument: string, options: ScreenshotOptions = {}): Promise<void> {
  const { url, width, height, wait, timeout, output, extension } = validateOptions(urlArgument, options);
  const browser = await chromium.launch();
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    loadingTimeouts.set(page, timeout * loadingTimeoutMultiplier);
    const { failure } = await watchForStops(page);
    await Promise.race([capturePage(page, url.href, output, extension, wait, options.beforeCapture), failure]);
    console.log(`Screenshot saved to ${output}`);
  } catch (error) {
    if (page !== undefined && !(await isQuoteLoading(page))) {
      const declined = error instanceof DeclinedError;
      const failedOutput = `${output.slice(0, -extension.length)}-${declined ? 'declined' : 'failed'}`;
      try {
        await mkdir(dirname(failedOutput), { recursive: true });
        await page.screenshot({
          path: `${failedOutput}.png`,
          type: 'png',
          fullPage: true,
          timeout,
          animations: 'disabled'
        });
        // The rendered DOM (React builds the page in the browser), saved for turning into test fixtures.
        await writeFile(`${failedOutput}.html`, await page.evaluate(() => document.documentElement.outerHTML));
        const saved = `${declined ? 'Declined' : 'Failure'} screenshot and HTML saved to ${failedOutput}.png/.html`;
        console.error(declined ? saved : color.Red(saved));
      } catch (captureError) {
        console.error(color.Red(`Could not capture failure screenshot: ${String(captureError)}`));
      }
    }

    throw error;
  } finally {
    await browser.close();
  }
}

async function capturePage(
  page: Page,
  url: string,
  output: string,
  extension: string,
  wait: number,
  beforeCapture?: (page: Page) => Promise<void>
): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'load' });
  if (response !== null && !response.ok()) {
    throw new Error(`Website returned HTTP ${response.status()}.`);
  }

  await checkForStops(page);
  await waitForQuoteLoading(page);
  await beforeCapture?.(page);
  await checkForStops(page);
  await waitForQuoteLoading(page);
  await scrollPage(page);
  await page.waitForTimeout(wait);
  await mkdir(dirname(output), { recursive: true });
  await waitForQuoteLoading(page);
  await checkForStops(page);
  const image = await page.screenshot({
    type: extension === '.png' ? 'png' : 'jpeg',
    fullPage: true,
    animations: 'disabled'
  });
  await checkForStops(page);
  await writeFile(output, image);
}

async function checkForStops(page: Page): Promise<void> {
  const headings = await page.locator('h2').allTextContents();
  if (headings.some((text) => text.trim() === 'Oops')) {
    throw new OopsError();
  }

  const declined = await page.evaluate(
    ({ declinedHeadingPattern, declinedTextPattern }) =>
      [...document.querySelectorAll('h1, h2, h3')].some((heading) =>
        new RegExp(declinedHeadingPattern, 'i').test(heading.textContent?.trim() ?? '')
      ) && new RegExp(declinedTextPattern, 'i').test(document.body.textContent),
    { declinedHeadingPattern, declinedTextPattern }
  );
  if (declined) {
    throw new DeclinedError();
  }
}

async function isQuoteLoading(page: Page): Promise<boolean> {
  return (
    (await page
      .locator('div.hp-loading-widget-screen')
      .or(page.locator('h2').filter({ hasText: /^Loading your quote$/ }))
      .count()) > 0
  );
}

async function waitForQuoteLoading(page: Page, timeout = loadingTimeouts.get(page)): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('div.hp-loading-widget-screen') === null &&
        [...document.querySelectorAll('h2')].every((heading) => heading.textContent?.trim() !== 'Loading your quote'),
      undefined,
      { timeout }
    );
  } catch (error) {
    throw new Error('Timed out waiting for quote loading screen to disappear.', { cause: error });
  }
}

/** Stops the capture when the page shows an Oops heading or a declined quote, whenever either appears. */
async function watchForStops(page: Page): Promise<{ failure: Promise<never> }> {
  let stop: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  await page.exposeFunction('__stopOnPage', (reason: string) => {
    stop(reason === 'declined' ? new DeclinedError() : new OopsError());
  });
  await page.addInitScript(
    ({ declinedHeadingPattern, declinedTextPattern }) => {
      let reported = false;

      const check = () => {
        if (reported) {
          return;
        }

        const headings = [...document.querySelectorAll('h1, h2, h3')].map(
          (heading) => heading.textContent?.trim() ?? ''
        );
        const reason = headings.some((text) => text === 'Oops')
          ? 'oops'
          : headings.some((text) => new RegExp(declinedHeadingPattern, 'i').test(text)) &&
              new RegExp(declinedTextPattern, 'i').test(document.body?.textContent ?? '')
            ? 'declined'
            : undefined;
        if (reason !== undefined) {
          reported = true;
          void (window as unknown as { __stopOnPage: (reason: string) => Promise<void> }).__stopOnPage(reason);
        }
      };

      new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
      check();
    },
    { declinedHeadingPattern, declinedTextPattern }
  );
  return { failure };
}

function validateOptions(urlArgument: string, options: ScreenshotOptions) {
  const url = new URL(urlArgument);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL must use http:// or https://.');
  }

  const width = integer(options.width ?? 1440, 'width', 1);
  const height = integer(options.height ?? 900, 'height', 1);
  const wait = integer(options.wait ?? 1000, 'wait', 0);
  const timeout = integer(options.timeout ?? 30000, 'timeout', 1);
  const output = resolve(options.output ?? 'screenshots/screenshot.png');
  const extension = extname(output).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
    throw new Error('Output must have a .png, .jpg, or .jpeg extension.');
  }

  return { url, width, height, wait, timeout, output, extension };
}

async function scrollPage(page: Page): Promise<void> {
  // Visit lazy-loaded content, bounding the pass for infinite-scroll websites.
  let reachedBottom = false;
  for (let step = 0; step < 100; step++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(150);
    reachedBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
    );
    if (reachedBottom) {
      break;
    }
  }

  if (!reachedBottom) {
    console.warn('Scroll limit reached; capturing currently loaded content.');
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

function integer(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }

  return value;
}
