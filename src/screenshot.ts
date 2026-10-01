import { mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

export interface ScreenshotOptions {
  output?: string;
  width?: number;
  height?: number;
  wait?: number;
  timeout?: number;
}

export async function screenshot(urlArgument: string, options: ScreenshotOptions = {}): Promise<void> {
  const { url, width, height, wait, timeout, output, extension } = validateOptions(urlArgument, options);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    const response = await page.goto(url.href, { waitUntil: 'load' });
    if (response !== null && !response.ok()) {
      throw new Error(`Website returned HTTP ${response.status()}.`);
    }

    await scrollPage(page);
    await page.waitForTimeout(wait);
    await mkdir(dirname(output), { recursive: true });
    await page.screenshot({
      path: output,
      type: extension === '.png' ? 'png' : 'jpeg',
      fullPage: true,
      animations: 'disabled'
    });
    console.log(`Screenshot saved to ${output}`);
  } finally {
    await browser.close();
  }
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
