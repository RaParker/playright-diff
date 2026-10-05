import { parseArgs } from 'node:util';
import { compare } from './compare.js';
import { quotePage, quotePages, type QuotePageOptions } from './quote-page.js';
import { readQuoteGuidList, selectQuoteGuids } from './quote-guid-list.js';
import { screenshot } from './screenshot.js';
import { loadEnvironment } from './environment.js';

const help = `Usage: npm start -- <screenshot|compare|quote-page|quote-pages> [arguments] [options]
Use npm run <action> -- --help for action options.`;

const screenshotHelp = `Usage: npm run screenshot -- <url> [options]
  -o, --output <path>     PNG or JPEG output (default: screenshots/screenshot.png)
  --width <pixels>        Viewport width (default: 1440)
  --height <pixels>       Viewport height (default: 900)
  --wait <milliseconds>   Extra delay after scrolling (default: 1000)
  --timeout <ms>          Navigation/action timeout (default: 30000)
  -h, --help              Show help`;

const compareHelp = `Usage: npm run compare -- <before-image> <after-image> [options]
  -o, --output <directory> New report directory (default: comparisons/run-<timestamp>)
  --threshold <0-255>      Ignore channel differences (default: 20)
  --language <code>        OCR language (default: eng)
  --no-ocr                 Skip text extraction
  -h, --help               Show help`;

const quoteHelp = `Usage: npm run quote-page -- <policyDetailsId> <historyId> [options]
  --no-ocr       Compare pixels without extracting text
  -h, --help     Show help`;

const quotePagesHelp = `Usage: npm run quote-pages -- [maxCount|guid] [options]
Runs quote-page with historyId 1 for each GUID in QUOTE_GUID_LIST_PATH
(default: the first 250; maxCount limits the count; guid selects one entry).
  --no-ocr       Compare pixels without extracting text
  -h, --help     Show help`;

async function main(): Promise<void> {
  const [action, ...args] = process.argv.slice(2);
  if (action === '--help' || action === '-h') {
    console.log(help);
    return;
  }

  if (action === 'screenshot') {
    await runScreenshot(args);
    return;
  }

  if (action === 'compare') {
    await runCompare(args);
    return;
  }

  if (action === 'quote-page') {
    await runQuotePage(args);
    return;
  }

  if (action === 'quote-pages') {
    await runQuotePages(args);
    return;
  }

  throw new Error(help);
}

async function runScreenshot(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      width: { type: 'string' },
      height: { type: 'string' },
      wait: { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(screenshotHelp);
    return;
  }

  const [url] = positionals;
  if (positionals.length !== 1 || url === undefined) {
    throw new Error(screenshotHelp);
  }

  await screenshot(url, {
    output: values.output,
    width: values.width === undefined ? undefined : Number(values.width),
    height: values.height === undefined ? undefined : Number(values.height),
    wait: values.wait === undefined ? undefined : Number(values.wait),
    timeout: values.timeout === undefined ? undefined : Number(values.timeout)
  });
}

async function runCompare(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      threshold: { type: 'string' },
      language: { type: 'string' },
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(compareHelp);
    return;
  }

  const [before, after] = positionals;
  if (positionals.length !== 2 || before === undefined || after === undefined) {
    throw new Error(compareHelp);
  }

  await compare(before, after, {
    output: values.output,
    threshold: values.threshold === undefined ? undefined : Number(values.threshold),
    language: values.language,
    useOcr: values['no-ocr'] !== true
  });
}

async function runQuotePage(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(quoteHelp);
    return;
  }

  const [policyDetailsId, historyArgument] = positionals;
  if (positionals.length !== 2 || policyDetailsId === undefined || historyArgument === undefined) {
    throw new Error(quoteHelp);
  }

  if (!/^\d+$/.test(historyArgument)) {
    throw new Error('historyId must be a non-negative safe integer.');
  }

  const environment = await loadEnvironment();

  await quotePage(policyDetailsId, Number(historyArgument), quotePageOptions(environment, values['no-ocr'] !== true));
}

async function runQuotePages(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(quotePagesHelp);
    return;
  }

  if (positionals.length > 1) {
    throw new Error(quotePagesHelp);
  }

  const environment = await loadEnvironment();
  const options = quotePageOptions(environment, values['no-ocr'] !== true);
  const listPath = required(environment, 'QUOTE_GUID_LIST_PATH');
  const policyDetailsIds = selectQuoteGuids(await readQuoteGuidList(listPath), positionals[0]);
  console.log(`Running quote-page for ${policyDetailsIds.length} policies from ${listPath}`);
  await quotePages(policyDetailsIds, 1, options);
}

function quotePageOptions(environment: Record<string, string | undefined>, useOcr: boolean): QuotePageOptions {
  return {
    mrpAndQuoteOutputDir: required(environment, 'MRP_AND_QUOTE_OUTPUT_DIR'),
    nhiQuotePageUrlTemplate: required(environment, 'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE'),
    tcasQuotePageUrlTemplate: required(environment, 'QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE'),
    useOcr,
    quoteGuidFallback: {
      quoteGuidUrl: required(environment, 'QUOTE_JOURNEY_QUOTE_GUID_URL'),
      agentId: required(environment, 'QUOTE_JOURNEY_AGENT_ID'),
      branchCode: required(environment, 'QUOTE_JOURNEY_BRANCH_CODE'),
      callMediaUser: required(environment, 'QUOTE_JOURNEY_CALL_MEDIA_USER')
    }
  };
}

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} must be configured in .env or the environment.`);
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
