import { parseArgs } from 'node:util';
import { color } from './color.js';
import { compare } from './compare.js';
import { maxConcurrency } from './concurrency.js';
import {
  defaultQuotePagesConcurrency,
  quotePage,
  quotePages,
  type QuotePageOptions,
  type QuotePagesOptions
} from './quote-page.js';
import { failedQuotePagesPath, readFailedQuotePages } from './failed-quote-pages.js';
import { isQuoteGuid, readQuoteGuidList, selectQuoteGuids } from './quote-guid-list.js';
import { prefetchMissingMrpFiles, reportMissingMrpFiles } from './mrp-fetch.js';
import { screenshot, ValidationError } from './screenshot.js';
import { loadEnvironment } from './environment.js';
import { outputPath, setOutputRoot } from './output-paths.js';
import { intervalToMs } from './interval.js';
import { summariseChangedAnswers } from './changed-answers.js';
import { collectQuoteResults, listDifferentPolicies, summariseQuoteResults } from './summarise.js';

const help = `Usage: npm start -- <screenshot|compare|quote-page|quote-pages|summarise> [arguments] [options]
Use npm run <action> -- --help for action options.
Each policy's output (screenshots, API responses, comparison report and result) is kept in
<policyDetailsId>-<historyId>/ in DIFF_OUTPUT_DIR (.env or environment), or the current directory when it is
not set.`;

const screenshotHelp = `Usage: npm run screenshot -- <url> [options]
  -o, --output <path>     PNG or JPEG output (default: screenshots/screenshot.png in DIFF_OUTPUT_DIR)
  --width <pixels>        Viewport width (default: 1440)
  --height <pixels>       Viewport height (default: 900)
  --wait <milliseconds>   Extra delay after scrolling (default: 1000)
  --timeout <ms>          Navigation/action timeout (default: 30000)
  -h, --help              Show help`;

const compareHelp = `Usage: npm run compare -- <before-image> <after-image> [options]
  -o, --output <directory> New report directory (default: comparisons/run-<timestamp> in DIFF_OUTPUT_DIR)
  --threshold <0-255>      Ignore channel differences (default: 20)
  --language <code>        OCR language (default: eng)
  --no-ocr                 Skip text extraction
  -h, --help               Show help`;

const quoteHelp = `Usage: npm run quote-page -- <policyDetailsId> <historyId> [options]
  --no-ocr       Compare pixels without extracting text
  -h, --help     Show help`;

const quotePagesUsage = 'Usage: npm run quote-pages -- [maxCount|guid|retry-failed|retry-different] [options]';

const quotePagesHelp = `${quotePagesUsage}

Runs quote-page (historyId 1) for the policies in QUOTE_GUID_LIST_PATH.

Selection:
  (none)            The first 250 GUIDs in the list
  <maxCount>        The first maxCount GUIDs
  <guid>            Just that GUID
  retry-failed      Only the policies that failed last time (saved in ${failedQuotePagesPath})
  retry-different   Every policy in DIFF_OUTPUT_DIR whose screenshots differed (the summarise
                    "differences" policies); leaves ${failedQuotePagesPath} untouched

Options:
  -c, --concurrency <n>  Policies run at once, 1-${maxConcurrency} (default: ${defaultQuotePagesConcurrency}; 1 runs them in turn)
  --no-fetch             Use only the -mrp.json files already saved; policies without one fail
  --no-ocr               Compare pixels without extracting text
  -h, --help             Show help

Environment (.env or environment):
  QUOTE_GUID_LIST_PATH         The GUID list (required)
  MRP_AND_QUOTE_OUTPUT_DIR     Where the -mrp.json files are kept (required)
  MRP_AND_QUOTE_PROJECT_DIR    Where mrp-and-quote's fetch runs (default: the output folder's parent)
  QUOTE_JOURNEY_*, QUOTE_PAGE_TIMEOUT
                               The quote-page settings (see the README)

Notes:
  - Missing -mrp.json files are fetched first with mrp-and-quote's fetch (OUTPUT_DIR set to the
    output folder); files already saved are always reused.
  - Failed policies are saved to ${failedQuotePagesPath}, except on one-off runs (a guid or a
    maxCount of 1).`;

const summariseModeNames = ['differences', 'changed-answers'];

const summariseUsage = `Usage: npm run summarise [${summariseModeNames.join('|')}] [-- options]`;

const summariseHelp = `${summariseUsage}      (alias: npm run summarize)

Summarises the quote-page results in <policyDetailsId>-<historyId>/ (in DIFF_OUTPUT_DIR).

Modes:
  (none)            Full report: each policy's differences, most common text changes, failed
                    policies and failures by reason, MRP records not retrieved, Oops pages, totals
  differences       Only the policies that differ (the ones quote-pages retry-different reruns)
  changed-answers   Combines every answer-changes.json (leaving out cover start changes) into
                    changed-answers.json and counts changes per question, most changed first

Options:
  -h, --help        Show help

Environment (.env or environment, both optional):
  QUOTE_GUID_LIST_PATH, MRP_AND_QUOTE_OUTPUT_DIR
                    Needed for the GUID list totals and the MRP records not retrieved;
                    those parts are skipped without them

Notes:
  - Outcomes come from each folder's result.json. Folders with only a report.json (older runs)
    count as compared.
  - Oops pages saved before a policy's last run started are not counted.
  - The exit code is 0 whatever the results, and 1 only when a file cannot be read (such as an
    invalid result.json or report.json, or a missing GUID list).`;

/** What `summarise` can be given after its name: only the differences, or the changed answers. */
const summariseModes = new Set(summariseModeNames);

/**
 * Gets the MRP files of the policies about to run ready: fetches the missing ones, or with `--no-fetch` only reports them.
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run.
 * @param guidList mrp-and-quote's GUID list, which limits what can be fetched.
 */
type PrepareMrpFiles = (policyDetailsIds: string[], historyId: number, guidList: string[]) => Promise<void>;

async function main(): Promise<void> {
  const [action, ...args] = process.argv.slice(2);
  if (action === '--help' || action === '-h') {
    console.log(help);
    return;
  }

  setOutputRoot(optional(await loadEnvironment(), 'DIFF_OUTPUT_DIR'));

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

  if (action === 'summarise' || action === 'summarize') {
    await runSummarise(args);
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
      concurrency: { type: 'string', short: 'c' },
      'no-fetch': { type: 'boolean' },
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(quotePagesHelp);
    return;
  }

  if (positionals.length > 1) {
    throw new Error(
      usageError(
        `quote-pages takes at most one argument (got ${positionals.join(' ')}).`,
        quotePagesUsage,
        'quote-pages'
      )
    );
  }

  const environment = await loadEnvironment();
  const options: QuotePagesOptions = {
    ...quotePageOptions(environment, values['no-ocr'] !== true),
    concurrency: parseConcurrency(values.concurrency)
  };
  const prepareMrpFiles: PrepareMrpFiles = (policyDetailsIds, historyId, guidList) =>
    values['no-fetch'] === true
      ? reportMissingMrpFiles(policyDetailsIds, historyId, options.mrpAndQuoteOutputDir)
      : prefetchMissingMrpFiles(policyDetailsIds, historyId, guidList, {
          outputDir: options.mrpAndQuoteOutputDir,
          projectDir: optional(environment, 'MRP_AND_QUOTE_PROJECT_DIR')
        });
  if (positionals[0] === 'retry-failed') {
    await retryFailedQuotePages(environment, options, prepareMrpFiles);
    return;
  }

  if (positionals[0] === 'retry-different') {
    await retryDifferentQuotePages(environment, options, prepareMrpFiles);
    return;
  }

  const listPath = required(environment, 'QUOTE_GUID_LIST_PATH');
  const guidList = await readQuoteGuidList(listPath);
  const policyDetailsIds = selectQuoteGuids(guidList, positionals[0]);
  console.log(`Running quote-page for ${policyDetailsIds.length} policies from ${listPath}`);
  await prepareMrpFiles(policyDetailsIds, 1, guidList);
  await quotePages(policyDetailsIds, 1, options, isOneOffSelector(positionals[0]) ? undefined : failedQuotePagesPath);
}

async function runSummarise(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } }
  });
  if (values.help === true) {
    console.log(summariseHelp);
    return;
  }

  if (positionals.length > 1) {
    throw new Error(
      usageError(`summarise takes at most one mode (got ${positionals.join(' ')}).`, summariseUsage, 'summarise')
    );
  }

  if (positionals[0] !== undefined && !summariseModes.has(positionals[0])) {
    const expected = summariseModeNames.join(' or ');
    throw new Error(
      usageError(`Unknown summarise mode "${positionals[0]}" (expected ${expected}).`, summariseUsage, 'summarise')
    );
  }

  if (positionals[0] === 'changed-answers') {
    await summariseChangedAnswers();
    return;
  }

  // Unlike quote-pages, the GUID list and MRP folder are optional: without them the GUID list totals are skipped.
  const environment = await loadEnvironment();
  await summariseQuoteResults({
    guidListPath: optional(environment, 'QUOTE_GUID_LIST_PATH'),
    mrpAndQuoteOutputDir: optional(environment, 'MRP_AND_QUOTE_OUTPUT_DIR'),
    differentOnly: positionals[0] === 'differences'
  });
}

/**
 * @returns A short error for a bad argument: the problem, the usage line and how to see the full help.
 */
function usageError(problem: string, usage: string, action: string): string {
  return `${problem}\n${usage}\nRun npm run ${action} -- --help for details.`;
}

/**
 * A one-off run (one GUID, or a maxCount of 1 or less) leaves the saved failures of the last list run untouched.
 */
function isOneOffSelector(selector: string | undefined): boolean {
  return selector !== undefined && (isQuoteGuid(selector) || (/^\d+$/.test(selector) && Number(selector) <= 1));
}

async function retryFailedQuotePages(
  environment: Record<string, string | undefined>,
  options: QuotePagesOptions,
  prepareMrpFiles: PrepareMrpFiles
): Promise<void> {
  const saved = await readFailedQuotePages(failedQuotePagesPath);
  if (saved === undefined || saved.failed.length === 0) {
    console.log(`No failed quote pages to retry (${failedQuotePagesPath}).`);
    return;
  }

  console.log(`Retrying ${saved.failed.length} failed policies from ${failedQuotePagesPath}`);
  const policyDetailsIds = saved.failed.map(({ policyDetailsId }) => policyDetailsId);
  const guidList = await readQuoteGuidList(required(environment, 'QUOTE_GUID_LIST_PATH'));
  await prepareMrpFiles(policyDetailsIds, saved.historyId, guidList);
  await quotePages(policyDetailsIds, saved.historyId, options, failedQuotePagesPath);
}

/**
 * Reruns every compared policy whose screenshots differed, one batch per history ID. The saved failures are left
 * untouched, so earlier failures not rerun here stay available to retry-failed.
 */
async function retryDifferentQuotePages(
  environment: Record<string, string | undefined>,
  options: QuotePagesOptions,
  prepareMrpFiles: PrepareMrpFiles
): Promise<void> {
  const root = outputPath();
  const different = listDifferentPolicies(await collectQuoteResults(root));
  if (different.length === 0) {
    console.log(`No different quote pages to retry (${root}).`);
    return;
  }

  console.log(`Retrying ${different.length} different policies from ${root}`);
  const guidList = await readQuoteGuidList(required(environment, 'QUOTE_GUID_LIST_PATH'));
  const failures: string[] = [];
  for (const historyId of new Set(different.map((policy) => policy.historyId))) {
    const policyDetailsIds = different
      .filter((policy) => policy.historyId === historyId)
      .map(({ policyDetailsId }) => policyDetailsId);
    try {
      // Inside the try, so a batch whose MRP files cannot be prepared does not stop the batches after it.
      await prepareMrpFiles(policyDetailsIds, historyId, guidList);
      await quotePages(policyDetailsIds, historyId, options);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

/** @returns The `--concurrency` value, or the default when it is not given. */
function parseConcurrency(value: string | undefined): number {
  if (value === undefined) {
    return defaultQuotePagesConcurrency;
  }

  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maxConcurrency) {
    throw new Error(`--concurrency must be an integer from 1 to ${maxConcurrency}.`);
  }

  return Number(value);
}

function quotePageOptions(environment: Record<string, string | undefined>, useOcr: boolean): QuotePageOptions {
  return {
    mrpAndQuoteOutputDir: required(environment, 'MRP_AND_QUOTE_OUTPUT_DIR'),
    nhiQuotePageUrlTemplate: required(environment, 'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE'),
    tcasQuotePageUrlTemplate: required(environment, 'QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE'),
    useOcr,
    timeout: parseQuotePageTimeout(optional(environment, 'QUOTE_PAGE_TIMEOUT')),
    quoteGuidFallback: {
      quoteGuidUrl: required(environment, 'QUOTE_JOURNEY_QUOTE_GUID_URL'),
      agentId: required(environment, 'QUOTE_JOURNEY_AGENT_ID'),
      branchCode: required(environment, 'QUOTE_JOURNEY_BRANCH_CODE'),
      callMediaUser: required(environment, 'QUOTE_JOURNEY_CALL_MEDIA_USER'),
      unsavedQuotePageUrlTemplate: required(environment, 'QUOTE_JOURNEY_NHI_UNSAVED_URL_TEMPLATE'),
      tcasReplacementUrlTemplate: required(environment, 'QUOTE_JOURNEY_TCAS_REPLACEMENT_URL_TEMPLATE')
    }
  };
}

/**
 * @returns The `QUOTE_PAGE_TIMEOUT` step timeout in milliseconds, or `undefined` (the 30 s default) when not set.
 * @throws When it is not a whole number with an optional `s`, `m`, `h` or `d` suffix (milliseconds without one), from
 * 1 ms to 8 hours.
 */
function parseQuotePageTimeout(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return intervalToMs(value.trim());
  } catch (error) {
    throw new Error(`QUOTE_PAGE_TIMEOUT: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function isProgrammingError(error: unknown): error is Error {
  return (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optional(environment: Record<string, string | undefined>, name: string): string | undefined {
  const value = environment[name];
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} must be configured in .env or the environment.`);
  }

  return value;
}

main().catch((error: unknown) => {
  // A programming error (such as a TypeError) is shown with its stack, so it can be traced; others are reported as is.
  const message = isProgrammingError(error) ? (error.stack ?? error.message) : describeError(error);
  console.error(error instanceof ValidationError ? color.Yellow(message) : color.Red(message));
  process.exitCode = 1;
});
