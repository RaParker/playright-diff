import { mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const help = `Usage: npm run screenshot -- <url> [options]

Options:
  -o, --output <path>     PNG or JPEG output (default: screenshots/screenshot.png)
  --width <pixels>        Viewport width (default: 1440)
  --height <pixels>       Viewport height (default: 900)
  --wait <milliseconds>   Extra delay after scrolling (default: 1000)
  --timeout <ms>          Navigation/action timeout (default: 30000)
  -h, --help              Show this help
`;

function integer(value: string, name: string, minimum: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }

  return number;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o', default: 'screenshots/screenshot.png' },
      width: { type: 'string', default: '1440' },
      height: { type: 'string', default: '900' },
      wait: { type: 'string', default: '1000' },
      timeout: { type: 'string', default: '30000' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) {
    console.log(help);
    return;
  }

  if (positionals.length !== 1) {
    throw new Error(help);
  }

  const url = new URL(positionals[0]!);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL must use http:// or https://.');
  }

  const width = integer(values.width, 'width', 1);
  const height = integer(values.height, 'height', 1);
  const wait = integer(values.wait, 'wait', 0);
  const timeout = integer(values.timeout, 'timeout', 1);
  const output = resolve(values.output);
  const extension = extname(output).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
    throw new Error('Output must have a .png, .jpg, or .jpeg extension.');
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    const response = await page.goto(url.href, { waitUntil: 'load' });
    if (response && !response.ok()) {
      throw new Error(`Website returned HTTP ${response.status()}.`);
    }

    // Visit content below the fold so typical lazy-loaded images can load.
    // Bound the scroll pass so infinite-scroll websites cannot loop forever.
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
