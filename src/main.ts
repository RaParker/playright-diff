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
import {
  fetchedHistoryId,
  filterMissingMrpFiles,
  prefetchMissingMrpFiles,
  reportMissingMrpFiles
} from './mrp-fetch.js';
import { screenshot, ValidationError } from './screenshot.js';
import { loadEnvironment } from './environment.js';
import { outputPath, setOutputRoot } from './output-paths.js';
import { intervalToMs } from './interval.js';
import { migrateOutput } from './migrate-output.js';
import { clearOutput } from './clear-output.js';
import { summariseChangedAnswers } from './changed-answers.js';
import {
  collectQuoteResults,
  listPoliciesToRecompare,
  listPoliciesToRetryFailed,
  summariseQuoteResults,
  type PolicyToRun
} from './summarise.js';

const help = `Usage: npm run <action> [-- arguments and options]

Actions:
  screenshot        Capture a full-page screenshot of one URL
  compare           Compare two images and report changed regions and text
  quote-page        Capture NHI and TCAS versions of one quote and compare them
  quote-pages       Run quote-page for every policy in a GUID list
  summarise         Summarise every quote-page result (alias: summarize)
  migrate-output    Move output from the old layout into one folder per policy
  clear-output      Delete the output folder (DIFF_OUTPUT_DIR) and everything in it
  help              Show this help

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

Runs quote-page (historyId 1) for the policies in QUOTE_GUID_LIST_PATH, or reruns policies already
in DIFF_OUTPUT_DIR (each with the history ID of its folder).

Selection:
  (none)            The first 250 GUIDs in the list
  <maxCount>        The first maxCount GUIDs
  <guid>            Just that GUID
  retry-failed      Every policy that failed or did not finish: those in ${failedQuotePagesPath},
                    those in DIFF_OUTPUT_DIR whose result is a failure, and folders with no result
  retry-different   Every policy in DIFF_OUTPUT_DIR whose screenshots or end points differed (the
                    summarise "differences" policies), and both-declined results saved before
                    declines were compared; leaves ${failedQuotePagesPath} untouched

Retries:
  retry-failed reruns the runs that did not finish a comparison (failed, or stopped part way).
  retry-different reruns the comparisons that finished but differ, to refresh their results.
  Together they cover every policy in DIFF_OUTPUT_DIR except identical ones and matching
  referrals, conditional quotes or declines; policies never run need a list run.
  Add --dry-run to see what either would run, and why.

Options:
  -c, --concurrency <n>  Policies run at once, 1-${maxConcurrency} (default: ${defaultQuotePagesConcurrency}; 1 runs them in turn)
  --dry-run              List the policies the selection would run, with why each was chosen, and the
                         MRP files missing; fetches, captures and saves nothing
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
  - Failed policies are saved to ${failedQuotePagesPath} by list runs (not one-off runs: a guid or
    a maxCount of 1) and by retry-failed when its policies share one history ID; retry-different
    leaves the file untouched.`;

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

const migrateOutputHelp = `Usage: npm run migrate-output [-- options]

Moves output from the old layout (screenshots/ and comparisons/<policyDetailsId>-<historyId>/) into one
<policyDetailsId>-<historyId>/ folder per policy, as quote-page now writes it, and points each moved
report.json and report.md at the screenshots' new place. comparisons/.ocr-cache moves to .ocr-cache.

Options:
  --apply           Move the files (without it, only lists what would move)
  --root <folder>   Output folder to migrate (default: DIFF_OUTPUT_DIR, or the current directory)
  -h, --help        Show help

Notes:
  - Nothing is overwritten: an entry whose target already exists is left in place and listed.
  - Entries that are not quote-page output (such as comparisons/run-<timestamp>) are left in place
    and listed. screenshots/ and comparisons/ are removed only when left empty.`;

const clearOutputHelp = `Usage: npm run clear-output

Deletes the output folder (DIFF_OUTPUT_DIR) and everything in it, after printing the folder and how many
entries it holds.

Options:
  -h, --help        Show help

Environment (.env or environment):
  DIFF_OUTPUT_DIR   Folder to delete (required; the current directory is never used instead)

Notes:
  - Nothing is deleted when DIFF_OUTPUT_DIR is a drive root, the user profile, this project, or a
    folder containing either; the exit code is then 1.
  - A missing folder is reported and the exit code is 0.
  - Other folders, such as MRP_AND_QUOTE_OUTPUT_DIR, are never touched.`;

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

  if (action === 'migrate-output') {
    await runMigrateOutput(args);
    return;
  }

  if (action === 'clear-output') {
    await runClearOutput(args);
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
      'dry-run': { type: 'boolean' },
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
  const plan =
    positionals[0] === 'retry-failed'
      ? await planRetryFailed()
      : positionals[0] === 'retry-different'
        ? await planRetryDifferent()
        : await planListRun(required(environment, 'QUOTE_GUID_LIST_PATH'), positionals[0]);
  if (plan.historyIds.length === 0) {
    console.log(plan.nothingToDo);
    return;
  }

  // Read only once there is something to run, so a retry with nothing to do needs no GUID list.
  const guidList = plan.guidList ?? (await readQuoteGuidList(required(environment, 'QUOTE_GUID_LIST_PATH')));
  if (values['dry-run'] === true) {
    await printQuotePagesPlan(plan, guidList, options.mrpAndQuoteOutputDir, values['no-fetch'] !== true);
    return;
  }

  console.log(plan.start);
  await runQuotePagesPlan(plan, async (policyDetailsIds, historyId) => {
    await prepareMrpFiles(policyDetailsIds, historyId, guidList);
    await quotePages(policyDetailsIds, historyId, options, plan.failedPath);
  });
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

async function runMigrateOutput(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      apply: { type: 'boolean' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(migrateOutputHelp);
    return;
  }

  if (positionals.length > 0) {
    throw new Error(
      usageError(
        `migrate-output takes no arguments (got ${positionals.join(' ')}).`,
        'Usage: npm run migrate-output [-- --apply] [--root <folder>]',
        'migrate-output'
      )
    );
  }

  await migrateOutput({ root: values.root, apply: values.apply === true });
}

async function runClearOutput(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(clearOutputHelp);
    return;
  }

  if (positionals.length > 0) {
    throw new Error(
      usageError(
        `clear-output takes no arguments (got ${positionals.join(' ')}).`,
        'Usage: npm run clear-output',
        'clear-output'
      )
    );
  }

  const outcome = await clearOutput(optional(await loadEnvironment(), 'DIFF_OUTPUT_DIR'));
  if (outcome === 'refused') {
    process.exitCode = 1;
  }
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

/**
 * What a quote-pages run would do: its policies, in one batch per history ID, and whether it replaces the saved
 * failures. Built before anything runs, so `--dry-run` can print it instead.
 */
interface QuotePagesPlan {
  /** Logged as the run starts, for example `Retrying 4 failed or unfinished policies from …`. */
  start: string;
  /** The same, worded for a dry run, for example `Would retry 4 failed or unfinished policies from …`. */
  wouldStart: string;
  /** Printed when there is nothing to run (no history IDs). */
  nothingToDo: string;
  /** The policies, each with why it was chosen when it was not simply picked from the GUID list. */
  policies: (PolicyToRun & { reason?: string })[];
  /** History IDs to run, in order; empty when there is nothing to run. */
  historyIds: number[];
  /** Failed-policies file the run replaces, or `undefined` when it leaves the file untouched. */
  failedPath?: string;
  /** The GUID list, when building the plan read it. */
  guidList?: string[];
}

/**
 * Plans a run of the policies picked from the GUID list. It always runs (an empty selection prints an empty summary),
 * and it replaces the saved failures unless it is a one-off run.
 */
async function planListRun(listPath: string, selector: string | undefined): Promise<QuotePagesPlan> {
  const guidList = await readQuoteGuidList(listPath);
  const policies = selectQuoteGuids(guidList, selector).map((policyDetailsId) => ({ policyDetailsId, historyId: 1 }));
  const policiesFrom = `${policies.length} policies from ${listPath}`;
  return {
    start: `Running quote-page for ${policiesFrom}`,
    wouldStart: `Would run quote-page for ${policiesFrom}`,
    nothingToDo: '',
    policies,
    historyIds: [1],
    failedPath: isOneOffSelector(selector) ? undefined : failedQuotePagesPath,
    guidList
  };
}

/**
 * Plans a rerun of every policy that failed or did not finish (see {@link listPoliciesToRetryFailed}): those in the
 * saved failures file, and those whose output folder records a failure or no result, which one-off and retry-different
 * runs leave out of the file. The file is replaced with the policies still failing when every rerun shares one history
 * ID, since it holds only one.
 */
async function planRetryFailed(): Promise<QuotePagesPlan> {
  const root = outputPath();
  const sources = `${failedQuotePagesPath} and ${root}`;
  const policies = listPoliciesToRetryFailed(
    await collectQuoteResults(root),
    await readFailedQuotePages(failedQuotePagesPath)
  );
  const historyIds = [...new Set(policies.map(({ historyId }) => historyId))];
  const policiesFrom = `${policies.length} failed or unfinished policies from ${sources}`;
  return {
    start: `Retrying ${policiesFrom}`,
    wouldStart: `Would retry ${policiesFrom}`,
    nothingToDo: `No failed quote pages to retry (${sources}).`,
    policies,
    historyIds,
    failedPath: historyIds.length === 1 ? failedQuotePagesPath : undefined
  };
}

/**
 * Plans a rerun of every compared policy whose screenshots or end points differed, and every both-declined result saved
 * before declines were compared (see {@link listPoliciesToRecompare}). The saved failures are left untouched, so
 * earlier failures not rerun here stay available to retry-failed.
 */
async function planRetryDifferent(): Promise<QuotePagesPlan> {
  const root = outputPath();
  const policies = listPoliciesToRecompare(await collectQuoteResults(root));
  const policiesFrom = `${policies.length} different policies from ${root}`;
  return {
    start: `Retrying ${policiesFrom}`,
    wouldStart: `Would retry ${policiesFrom}`,
    nothingToDo: `No different quote pages to retry (${root}).`,
    policies,
    historyIds: [...new Set(policies.map(({ historyId }) => historyId))]
  };
}

/**
 * Prints what a plan would run, without fetching, capturing or saving anything: each policy with why it was chosen,
 * the policies whose MRP file is missing (fetched first, or failing with `--no-fetch`), and what happens to the saved
 * failures.
 * @param plan The plan.
 * @param guidList The GUID list, which limits the MRP files a run can fetch.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder, checked for each policy's MRP file.
 * @param fetch Whether the run would fetch missing MRP files (no `--no-fetch`).
 */
async function printQuotePagesPlan(
  plan: QuotePagesPlan,
  guidList: string[],
  mrpAndQuoteOutputDir: string,
  fetch: boolean
): Promise<void> {
  console.log(color.Cyan('Dry run: nothing is fetched, captured or saved.'));
  console.log(plan.wouldStart);
  for (const { policyDetailsId, historyId, reason } of plan.policies) {
    console.log(`  ${policyDetailsId}-${historyId}${reason === undefined ? '' : `  ${color.Gray(reason)}`}`);
  }

  // Only history ID 1 MRP files are fetched (see prefetchMissingMrpFiles).
  const missing = await filterMissingMrpFiles(
    plan.policies
      .filter(({ historyId }) => historyId === fetchedHistoryId)
      .map(({ policyDetailsId }) => policyDetailsId),
    mrpAndQuoteOutputDir
  );
  const fetchable = missing.filter((policyDetailsId) => guidList.includes(policyDetailsId));
  const unfetchable = missing.filter((policyDetailsId) => !fetch || !guidList.includes(policyDetailsId));
  if (fetch && fetchable.length > 0) {
    console.log(`${fetchable.length} MRP files would be fetched first: ${fetchable.join(', ')}`);
  }

  if (unfetchable.length > 0) {
    const why = fetch ? 'not in the GUID list' : '--no-fetch';
    console.log(
      color.Yellow(`${unfetchable.length} policies have no MRP file and would fail (${why}): ${unfetchable.join(', ')}`)
    );
  }

  console.log(
    plan.failedPath === undefined
      ? `${failedQuotePagesPath} would be left untouched.`
      : `${plan.failedPath} would be replaced with the policies that fail.`
  );
}

/**
 * Runs a plan's policies in one batch per history ID. A batch that fails, including while its MRP files are prepared,
 * does not stop the batches after it.
 * @param plan The plan.
 * @param run Prepares and runs one batch.
 * @throws After every batch has run, with each failed batch's message, when any failed.
 */
async function runQuotePagesPlan(
  plan: QuotePagesPlan,
  run: (policyDetailsIds: string[], historyId: number) => Promise<void>
): Promise<void> {
  const failures: string[] = [];
  for (const historyId of plan.historyIds) {
    const policyDetailsIds = plan.policies
      .filter((policy) => policy.historyId === historyId)
      .map(({ policyDetailsId }) => policyDetailsId);
    try {
      await run(policyDetailsIds, historyId);
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
