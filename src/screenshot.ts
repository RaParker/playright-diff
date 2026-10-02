import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

export interface ScreenshotOptions {
  output?: string;
  width?: number;
  height?: number;
  wait?: number;
  timeout?: number;
  beforeCapture?: (page: Page) => Promise<void>;
}

export async function screenshot(urlArgument: string, options: ScreenshotOptions = {}): Promise<void> {
  const { url, width, height, wait, timeout, output, extension } = validateOptions(urlArgument, options);
  const browser = await chromium.launch();
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    const { failure } = await watchForOops(page);
    await Promise.race([capturePage(page, url.href, output, extension, wait, options.beforeCapture), failure]);
    console.log(`Screenshot saved to ${output}`);
  } catch (error) {
    if (
      page !== undefined &&
      (await page
        .locator('div.hp-loading-widget-screen')
        .or(page.locator('h2').filter({ hasText: /^Loading your quote$/ }))
        .count()) === 0
    ) {
      const failedOutput = `${output.slice(0, -extension.length)}-failed.png`;
      try {
        await mkdir(dirname(failedOutput), { recursive: true });
        await page.screenshot({ path: failedOutput, type: 'png', fullPage: true, timeout, animations: 'disabled' });
        console.error(`Failure screenshot saved to ${failedOutput}`);
      } catch (captureError) {
        console.error(`Could not capture failure screenshot: ${String(captureError)}`);
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

  await checkForOops(page);
  await waitForQuoteLoading(page);
  await beforeCapture?.(page);
  await checkForOops(page);
  await waitForQuoteLoading(page);
  await scrollPage(page);
  await page.waitForTimeout(wait);
  await mkdir(dirname(output), { recursive: true });
  await waitForQuoteLoading(page);
  await checkForOops(page);
  const image = await page.screenshot({
    type: extension === '.png' ? 'png' : 'jpeg',
    fullPage: true,
    animations: 'disabled'
  });
  await checkForOops(page);
  await writeFile(output, image);
}

async function checkForOops(page: Page): Promise<void> {
  const headings = await page.locator('h2').allTextContents();
  if (headings.some((text) => text.trim() === 'Oops')) {
    throw new Error('Website displayed <h2>Oops</h2>; stopping the journey.');
  }
}

async function waitForQuoteLoading(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('div.hp-loading-widget-screen') === null &&
        [...document.querySelectorAll('h2')].every((heading) => heading.textContent?.trim() !== 'Loading your quote')
    );
  } catch (error) {
    throw new Error('Timed out waiting for quote loading screen to disappear.', { cause: error });
  }
}

async function watchForOops(page: Page): Promise<{ failure: Promise<never> }> {
  let stop: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  await page.exposeFunction('__stopOnOops', () => {
    stop(new Error('Website displayed <h2>Oops</h2>; stopping the journey.'));
  });
  await page.addInitScript(() => {
    let reported = false;

    const check = () => {
      if (!reported && [...document.querySelectorAll('h2')].some((heading) => heading.textContent?.trim() === 'Oops')) {
        reported = true;
        void (window as unknown as { __stopOnOops: () => Promise<void> }).__stopOnOops();
      }
    };

    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
    check();
  });
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
