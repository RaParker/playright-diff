import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import {
  answerChangesFileName,
  collectAnswerChanges,
  startAnswerChangeAttempt,
  writeAnswerChanges,
  type AnswerChangesByFlow
} from './answer-changes.js';
import { apiResponsesFolder } from './api-responses.js';
import { color, failureColor } from './color.js';
import { compare } from './compare.js';
import { runConcurrently, validateConcurrency } from './concurrency.js';
import { isMissing, parseJson } from './fs-helpers.js';
import { runWithLogPrefix, withPrefixedConsole } from './log-context.js';
import { writeFailedQuotePages, type FailedQuotePage } from './failed-quote-pages.js';
import {
  readQuoteGuidMapping,
  requestQuoteGuid,
  saveQuoteGuidMapping,
  type QuoteGuidRequestOptions
} from './quote-guid.js';
import { selectAnnualPayment } from './payment.js';
import { removeQuoteOutput } from './quote-output.js';
import { writeQuoteResult, type QuoteResult } from './quote-result.js';
import { quoteSummary } from './quote-summary.js';
import {
  DeclinedError,
  OopsError,
  screenshot,
  UnexpectedPageError,
  ValidationError,
  type ScreenshotOptions
} from './screenshot.js';
import { tcasQuote } from './tcas-quote.js';
import { unsavedQuote } from './unsaved-quote.js';
import { outputPath } from './output-paths.js';

export interface QuotePageOptions {
  mrpAndQuoteOutputDir: string;
  nhiQuotePageUrlTemplate: string;
  tcasQuotePageUrlTemplate: string;
  useOcr?: boolean;
  /**
   * Step timeout in milliseconds for every NHI and TCAS capture (default: the screenshot default, 30000). Quote loading
   * screens get twice as long.
   */
  timeout?: number;
  /** When set, an NHI Oops requests a replacement quote GUID, records it, and retries NHI once. */
  quoteGuidFallback?: QuoteGuidFallbackOptions;
}

/**
 * Elements masked in both flows' screenshots. The footer is the same on NHI and TCAS, but OCR reads its separators
 * (`»`, `=`, `+`) differently from one capture to the next, which reported false text changes.
 */
const maskedSelectors = ['.hp-footer'];

/** How one quote-page run ended: both sides quoted and were compared, or both declined (nothing to compare). */
export type QuotePageResult = 'compared' | 'declined';

/** How one capture ended: the quote page was captured, or the site declined to quote. */
type CaptureOutcome = 'captured' | 'declined';

interface NhiCapture {
  /** Replacement quote GUID captured, or `undefined` when the original was captured. */
  replacementGuid?: string;
  outcome: CaptureOutcome;
}

export interface QuoteGuidFallbackOptions extends QuoteGuidRequestOptions {
  /** Mapping JSON file of original to replacement quote GUIDs (default: quote-guid-mapping.json). */
  mappingPath?: string;
  /**
   * Journey URL, with `{artemisQuoteGuid}`, for a replacement quote not yet saved to NHI (`nhi=false`). Driving it
   * to the quote page saves the quote to NHI.
   */
  unsavedQuotePageUrlTemplate: string;
  /**
   * TCAS quote summary URL, with `{artemisQuoteGuid}`, captured instead of the original TCAS policy whenever NHI uses
   * a replacement quote, so both sides show the same answers (the "TCAS Quote Summary (GUID)" shape listed by
   * Quote Journey's `/api/developer/links`).
   */
  tcasReplacementUrlTemplate: string;
}

/**
 * Captures the NHI and TCAS versions of one quote and compares them. Any answers a flow changed so the journey would
 * accept the test data are saved to `<policyDetailsId>-<historyId>/answer-changes.json` in the output folder, whether
 * the run compared, declined or failed. The screenshots, API responses and comparison report are saved in that folder
 * too.
 * @param policyArgument TCAS policy details ID (32 hexadecimal characters).
 * @param historyId TCAS history ID.
 * @param options Input folder, URL templates and the optional NHI Oops fallback.
 * @returns `'compared'`, or `'declined'` when both sides declined to quote (the comparison is skipped).
 * @throws When the inputs are invalid, a capture fails, or only one side declined to quote. A
 * {@link ValidationError} when every failed capture stopped on a validation error.
 */
export async function quotePage(
  policyArgument: string,
  historyId: number,
  options: QuotePageOptions
): Promise<QuotePageResult> {
  if (!/^[0-9a-f]{32}$/i.test(policyArgument)) {
    throw new Error('policyDetailsId must be a UUID with dashes removed (32 hexadecimal characters).');
  }

  const policyDetailsId = policyArgument.toUpperCase();
  if (!Number.isSafeInteger(historyId) || historyId < 0) {
    throw new Error('historyId must be a non-negative safe integer.');
  }

  const run = { policyDetailsId, historyId, startedAt: new Date().toISOString() };
  const changes: AnswerChangesByFlow = {};
  let outcome: QuotePageResult;
  try {
    outcome = await collectAnswerChanges(changes, () => captureAndCompare(policyDetailsId, historyId, options));
  } catch (error) {
    await saveAnswerChanges(policyDetailsId, historyId, changes);
    await saveQuoteResult({
      ...run,
      outcome: 'failed',
      validation: error instanceof ValidationError,
      issues: (error instanceof Error ? error.message : String(error)).split('\n'),
      finishedAt: new Date().toISOString()
    });
    throw error;
  }

  await saveAnswerChanges(policyDetailsId, historyId, changes);
  await saveQuoteResult({ ...run, outcome, validation: false, issues: [], finishedAt: new Date().toISOString() });
  return outcome;
}

/** Default number of policies {@link quotePages} runs at once. */
export const defaultQuotePagesConcurrency = 3;

/** Issue saved for a policy a quote-pages run has not finished, so `retry-failed` reruns it if the run is stopped. */
const unfinishedIssue = 'Not finished: the run stopped before this policy completed.';

/** Characters of the policy details ID shown in each log line's prefix when policies run at once. */
const logPrefixIdLength = 8;

/** Options for {@link quotePages}: those of each {@link quotePage} run, plus how many run at once. */
export interface QuotePagesOptions extends QuotePageOptions {
  /** Most policies run at once (default: {@link defaultQuotePagesConcurrency}); 1 runs them one after another. */
  concurrency?: number;
}

/** How one policy of a quote-pages run ended. */
type PolicyRunOutcome = { status: QuotePageResult } | { status: 'failed'; message: string; validation: boolean };

/**
 * Runs {@link quotePage} for each policy, several at once, continuing past failures. Repeated IDs (in any case) run
 * once, at their first position, since every run of a policy writes the same files. Policies start in list order;
 * when more than one runs at once, each line a policy logs is prefixed with its position and the start of its ID.
 * @param requestedIds Policy details IDs to capture and compare.
 * @param historyId History ID used for every policy.
 * @param options Options passed to each {@link quotePage} run, and the concurrency.
 * @param failedPath File that the run's failed policies replace, for `quote-pages -- retry-failed`; not written when omitted.
 * It is saved as the run starts and after each policy, listing the policies not finished yet as failed too, so a run
 * that is stopped part way leaves them all to retry. After all runs, saves the failed policies in list order (deleting
 * the file when none failed), then prints a summary: the counts, then each failed policy with its issues.
 * @throws When the concurrency is out of range, or after all runs when any policy failed. Policies where
 * both sides declined are not failures.
 */
export async function quotePages(
  requestedIds: string[],
  historyId: number,
  options: QuotePagesOptions,
  failedPath?: string
): Promise<void> {
  const concurrency = options.concurrency ?? defaultQuotePagesConcurrency;
  validateConcurrency(concurrency);
  const policyDetailsIds = removeRepeatedIds(requestedIds);
  const outcomes: (PolicyRunOutcome | undefined)[] = policyDetailsIds.map(() => undefined);
  const progress = failedQuotePagesProgress(failedPath, historyId);
  progress.save(listFailures(policyDetailsIds, outcomes));
  const runAll = () =>
    runConcurrently(policyDetailsIds, concurrency, async (policyDetailsId, index) => {
      const position = `${index + 1}/${policyDetailsIds.length}`;
      console.log(color.Cyan(`[${position}] ${policyDetailsId}-${historyId}`));
      const run = () => runPolicy(policyDetailsId, historyId, options);
      outcomes[index] =
        concurrency === 1
          ? await run()
          : await runWithLogPrefix(`[${position} ${policyDetailsId.slice(0, logPrefixIdLength)}]`, run);
      progress.save(listFailures(policyDetailsIds, outcomes));
    });
  await (concurrency === 1 ? runAll() : withPrefixedConsole(runAll));
  await progress.settled();

  const failures = listFailures(policyDetailsIds, outcomes);
  const validationFailures = new Set(
    policyDetailsIds.filter((_policyDetailsId, index) => {
      const outcome = outcomes[index];
      return outcome?.status === 'failed' && outcome.validation;
    })
  );
  const declined = outcomes.filter((outcome) => outcome?.status === 'declined').length;
  if (failedPath !== undefined) {
    await writeFailedQuotePages(failedPath, { historyId, failed: failures });
  }

  printSummary(policyDetailsIds.length, historyId, declined, failures, validationFailures);
  if (failures.length > 0 && failedPath !== undefined) {
    console.log(
      color.Gray(`Failed policies saved to ${failedPath}; retry them with npm run quote-pages -- retry-failed`)
    );
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${policyDetailsIds.length} quote pages failed; see the summary above.`);
  }
}

/**
 * Lists a quote-pages run's failed policies in list order, with a policy that has not finished yet listed as failed
 * with {@link unfinishedIssue}.
 */
function listFailures(policyDetailsIds: string[], outcomes: (PolicyRunOutcome | undefined)[]): FailedQuotePage[] {
  return policyDetailsIds.flatMap((policyDetailsId, index) => {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      return [{ policyDetailsId, issues: [unfinishedIssue] }];
    }

    return outcome.status === 'failed' ? [{ policyDetailsId, issues: outcome.message.split('\n') }] : [];
  });
}

/**
 * Saves the failed-policies file while a run is going, one write at a time in the order asked for. A write that fails
 * only warns, since the run's final save reports its own errors.
 * @param failedPath File to save, or `undefined` to save nothing.
 * @param historyId History ID of the run.
 * @returns `save`, which queues a write of the given failures, and `settled`, which waits for the queued writes.
 */
function failedQuotePagesProgress(
  failedPath: string | undefined,
  historyId: number
): { save: (failed: FailedQuotePage[]) => void; settled: () => Promise<void> } {
  let writes = Promise.resolve();
  return {
    save: (failed) => {
      if (failedPath === undefined) {
        return;
      }

      writes = writes
        .then(() => writeFailedQuotePages(failedPath, { historyId, failed }))
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          console.log(color.Yellow(`Could not save the run's progress to ${failedPath}: ${reason}`));
        });
    },
    settled: () => writes
  };
}

/**
 * Drops repeated policy details IDs (compared case-insensitively), keeping each one's first position, and reports how
 * many were dropped.
 */
function removeRepeatedIds(policyDetailsIds: string[]): string[] {
  const seen = new Set<string>();
  const unique = policyDetailsIds.filter((policyDetailsId) => {
    const key = policyDetailsId.toUpperCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
  const repeated = policyDetailsIds.length - unique.length;
  if (repeated > 0) {
    const ids = repeated === 1 ? 'ID' : 'IDs';
    console.log(color.Yellow(`Skipping ${repeated} repeated policy ${ids}; each policy runs once.`));
  }

  return unique;
}

/**
 * Runs {@link quotePage} for one policy of a quote-pages run, logging any failure rather than throwing it.
 * @returns The policy's result, or its failure message and whether it was a validation failure.
 */
async function runPolicy(
  policyDetailsId: string,
  historyId: number,
  options: QuotePageOptions
): Promise<PolicyRunOutcome> {
  try {
    return { status: await quotePage(policyDetailsId, historyId, options) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const validation = error instanceof ValidationError;
    console.error(failureColor(validation)(message));
    return { status: 'failed', message, validation };
  }
}

/**
 * Captures both flows for a policy whose ID is valid, then compares them unless a side failed or declined.
 * @returns `'compared'`, or `'declined'` when both sides declined.
 * @throws As {@link quotePage}.
 */
async function captureAndCompare(
  policyDetailsId: string,
  historyId: number,
  options: QuotePageOptions
): Promise<QuotePageResult> {
  const basename = `${policyDetailsId}-${historyId}`;
  const artemisQuoteGuid = await readQuoteGuid(resolve(options.mrpAndQuoteOutputDir, `${basename}-mrp.json`));
  const fallback = options.quoteGuidFallback;
  // Validate the GUID templates before any capture starts.
  templateUrl(options.nhiQuotePageUrlTemplate, { artemisQuoteGuid });
  if (fallback !== undefined) {
    templateUrl(fallback.unsavedQuotePageUrlTemplate, { artemisQuoteGuid });
    templateUrl(fallback.tcasReplacementUrlTemplate, { artemisQuoteGuid });
  }

  const tcasUrl = templateUrl(options.tcasQuotePageUrlTemplate, {
    policyDetailsId,
    historyId: String(historyId)
  });
  const nhiPath = outputPath(basename, 'nhi.png');
  const tcasPath = outputPath(basename, 'tcas.png');
  const mappingPath = resolve(fallback?.mappingPath ?? 'quote-guid-mapping.json');
  const mappedGuid = fallback === undefined ? undefined : (await readQuoteGuidMapping(mappingPath))[artemisQuoteGuid];
  // Inputs are valid, so clear the previous run's results before writing new ones.
  await removeQuoteOutput(basename);
  // A mapped replacement means TCAS must wait for NHI to save it; otherwise the original TCAS policy runs alongside.
  const originalTcasAttempt =
    mappedGuid === undefined
      ? startAnswerChangeAttempt(() =>
          captureAt('TCAS', tcasUrl, {
            output: tcasPath,
            timeout: options.timeout,
            beforeCapture: withAnnualPayment('TCAS', tcasQuote)
          })
        )
      : undefined;
  const [nhi, originalTcas] = await Promise.allSettled([
    captureNhi(artemisQuoteGuid, mappedGuid, mappingPath, policyDetailsId, historyId, nhiPath, options),
    originalTcasAttempt?.result
  ]);
  let tcas = originalTcas;
  const replacementGuid = nhi.status === 'fulfilled' ? nhi.value.replacementGuid : undefined;
  // The original TCAS capture's answer changes are saved only when no replacement capture takes its place.
  if (replacementGuid === undefined || fallback === undefined) {
    originalTcasAttempt?.keep();
  } else {
    // The original capture's failure is not reported with the run's result, so it is logged for investigating.
    if (originalTcas.status === 'rejected') {
      const reason: unknown = originalTcas.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      console.log(color.Gray(`TCAS: original capture failed, so the replacement takes its place: ${message}`));
    }

    console.log(`TCAS: using replacement quote GUID ${replacementGuid} to match NHI.`);
    const replacementUrl = templateUrl(fallback.tcasReplacementUrlTemplate, { artemisQuoteGuid: replacementGuid });
    [tcas] = await Promise.allSettled([
      captureAt('TCAS', replacementUrl, {
        output: tcasPath,
        timeout: options.timeout,
        beforeCapture: withAnnualPayment('TCAS', quoteSummary('TCAS'))
      })
    ]);
  }

  const captures = [nhi, tcas];
  const rejected = captures.flatMap((result, index) =>
    result.status === 'rejected' ? [{ label: index === 0 ? 'NHI' : 'TCAS', reason: result.reason as unknown }] : []
  );
  if (rejected.length > 0) {
    const message = `Quote capture failed; comparison skipped.\n${rejected
      .map(({ label, reason }) => `${label}: ${reason instanceof Error ? reason.message : String(reason)}`)
      .join('\n')}`;
    // Shown in yellow only when every failed side stopped on validation; any other failure keeps it red.
    throw rejected.every(({ reason }) => reason instanceof ValidationError)
      ? new ValidationError(message)
      : new Error(message);
  }

  const nhiOutcome = nhi.status === 'fulfilled' ? nhi.value.outcome : undefined;
  const tcasOutcome = tcas.status === 'fulfilled' ? tcas.value : undefined;
  if (nhiOutcome === 'declined' && tcasOutcome === 'declined') {
    console.log('NHI and TCAS both declined the quote; comparison skipped.');
    return 'declined';
  }

  if (nhiOutcome === 'declined' || tcasOutcome === 'declined') {
    const describe = (outcome: CaptureOutcome | undefined) => (outcome === 'declined' ? 'declined' : 'quoted');
    throw new Error(
      `Quote outcomes differ: NHI ${describe(nhiOutcome)}, TCAS ${describe(tcasOutcome)}; comparison skipped.`
    );
  }

  await compare(nhiPath, tcasPath, { output: outputPath(basename), reuseOutput: true, useOcr: options.useOcr });
  return 'compared';
}

/**
 * Saves a run's result for the summarise command. Only warns when it cannot, so a successful run still succeeds and a
 * failed run still reports its own error rather than the write's.
 */
async function saveQuoteResult(result: QuoteResult): Promise<void> {
  try {
    await writeQuoteResult(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(color.Yellow(`Could not save the result of ${result.policyDetailsId}-${result.historyId}: ${reason}`));
  }
}

/**
 * Saves the answers a run changed in the policy's output folder. Only warns when it cannot, like
 * {@link saveQuoteResult}.
 */
async function saveAnswerChanges(
  policyDetailsId: string,
  historyId: number,
  changes: AnswerChangesByFlow
): Promise<void> {
  const basename = `${policyDetailsId}-${historyId}`;
  const path = outputPath(basename, answerChangesFileName);
  try {
    if (await writeAnswerChanges(path, { policyDetailsId, historyId, changes })) {
      console.log(color.Gray(`Answer changes saved to ${path}`));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(color.Yellow(`Could not save the answer changes of ${basename}: ${reason}`));
  }
}

async function readQuoteGuid(mrpPath: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(mrpPath, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`No saved MRP for this quote: ${mrpPath}`, { cause: error });
    }

    throw error;
  }

  const mrp = parseJson(content, mrpPath);
  if (mrp === null || typeof mrp !== 'object' || !('artemisQuoteGuid' in mrp)) {
    throw new Error(`MRP file must contain the "artemisQuoteGuid" property: ${mrpPath}`);
  }

  const artemisQuoteGuid = mrp['artemisQuoteGuid'];
  if (typeof artemisQuoteGuid !== 'string' || artemisQuoteGuid.trim().length === 0) {
    throw new Error('MRP "artemisQuoteGuid" must be a non-empty string.');
  }

  return artemisQuoteGuid;
}

/**
 * Captures the NHI quote page, falling back to a replacement quote GUID when the original shows Oops.
 * @returns The capture's outcome, with the replacement quote GUID when one was used.
 */
async function captureNhi(
  artemisQuoteGuid: string,
  mappedGuid: string | undefined,
  mappingPath: string,
  policyDetailsId: string,
  historyId: number,
  output: string,
  options: QuotePageOptions
): Promise<NhiCapture> {
  const capture = (quoteGuid: string) =>
    captureAt('NHI', templateUrl(options.nhiQuotePageUrlTemplate, { artemisQuoteGuid: quoteGuid }), {
      output,
      timeout: options.timeout,
      beforeCapture: withAnnualPayment('NHI', quoteSummary('NHI'))
    });
  const fallback = options.quoteGuidFallback;
  if (fallback === undefined) {
    return { outcome: await capture(artemisQuoteGuid) };
  }

  // An attempt that shows Oops is replaced by the unsaved journey below, so only that journey's answer changes count.
  const captureUnlessOops = (quoteGuid: string) => keepAnswerChangesUnlessOops(() => capture(quoteGuid));

  // Replacement quotes exist only in the question set store until the journey's quote button saves them to NHI.
  const captureUnsaved = (quoteGuid: string) =>
    captureAt('NHI', templateUrl(fallback.unsavedQuotePageUrlTemplate, { artemisQuoteGuid: quoteGuid }), {
      output,
      timeout: options.timeout,
      beforeCapture: withAnnualPayment('NHI', unsavedQuote)
    });
  if (mappedGuid !== undefined) {
    console.log(`NHI: using mapped quote GUID ${mappedGuid} for ${artemisQuoteGuid}.`);
    try {
      return { replacementGuid: mappedGuid, outcome: await captureUnlessOops(mappedGuid) };
    } catch (error) {
      if (!(error instanceof OopsError)) {
        throw error;
      }

      console.log(`NHI: mapped quote GUID ${mappedGuid} is not saved to NHI yet; running its journey.`);
      return { replacementGuid: mappedGuid, outcome: await captureUnsaved(mappedGuid) };
    }
  }

  try {
    return { outcome: await captureUnlessOops(artemisQuoteGuid) };
  } catch (error) {
    if (!(error instanceof OopsError)) {
      throw error;
    }

    const replacementGuid = await requestReplacementGuid(error, policyDetailsId, historyId, fallback);
    await saveQuoteGuidMapping(mappingPath, artemisQuoteGuid, replacementGuid);
    console.log(
      `NHI: mapped ${artemisQuoteGuid} to new quote GUID ${replacementGuid} in ${mappingPath}; running its journey.`
    );
    return { replacementGuid, outcome: await captureUnsaved(replacementGuid) };
  }
}

/**
 * Runs a capture attempt, saving its answer changes unless it shows Oops (see {@link startAnswerChangeAttempt}).
 * @returns The attempt's result.
 * @throws The attempt's error.
 */
async function keepAnswerChangesUnlessOops<T>(task: () => Promise<T>): Promise<T> {
  const attempt = startAnswerChangeAttempt(task);
  try {
    const result = await attempt.result;
    attempt.keep();
    return result;
  } catch (error) {
    if (!(error instanceof OopsError)) {
      attempt.keep();
    }

    throw error;
  }
}

/**
 * Logs the URL a flow opens, captures it, and adds the URL to any failure. The page's API responses are saved beside
 * the screenshot (see {@link apiResponsesFolder}), so the data behind a difference can be compared.
 * @returns `'declined'` when the site declined to quote (its `-declined.png` is saved), otherwise `'captured'`.
 * @throws The capture's error with the URL appended; an {@link OopsError}, {@link ValidationError} or
 * {@link UnexpectedPageError} keeps its class.
 */
async function captureAt(label: string, url: string, options: ScreenshotOptions): Promise<CaptureOutcome> {
  console.log(`${label}: opening ${url}`);
  try {
    await screenshot(url, {
      ...options,
      mask: maskedSelectors,
      apiResponsesFolder: options.output === undefined ? undefined : apiResponsesFolder(options.output)
    });
    return 'captured';
  } catch (error) {
    if (error instanceof DeclinedError) {
      console.log(`${label}: quote declined (${url}).`);
      return 'declined';
    }

    if (error instanceof OopsError) {
      throw new OopsError(url);
    }

    if (error instanceof ValidationError) {
      throw new ValidationError(`${error.message} (${url})`, { cause: error });
    }

    if (error instanceof UnexpectedPageError) {
      throw new UnexpectedPageError(`${error.message} (${url})`, { cause: error });
    }

    throw new Error(`${error instanceof Error ? error.message : String(error)} (${url})`, { cause: error });
  }
}

/**
 * Prints the quote-pages summary: a title, the counts, then each failed policy with its issues indented below it.
 * Validation failures are yellow and other failures red; the failed count is yellow only when every failure is one.
 */
function printSummary(
  total: number,
  historyId: number,
  declined: number,
  failures: FailedQuotePage[],
  validationFailures: Set<string>
): void {
  const failed = `${failures.length} failed`;
  const allValidation = failures.every(({ policyDetailsId }) => validationFailures.has(policyDetailsId));
  console.log(`\n${color.Cyan('Quote pages summary')}`);
  console.log(
    `${color.Green(`${total - failures.length} passed`)} (${declined} both declined), ${failures.length > 0 ? failureColor(allValidation)(failed) : failed}.`
  );
  for (const { policyDetailsId, issues } of failures) {
    console.log(`${policyDetailsId}-${historyId}`);
    for (const issue of issues) {
      console.log(`  ${failureColor(validationFailures.has(policyDetailsId))(issue)}`);
    }
  }
}

/** Follows a journey to the quote page, then selects annual payments so both flows capture the same price. */
function withAnnualPayment(label: string, journey: (page: Page) => Promise<void>): (page: Page) => Promise<void> {
  return async (page) => {
    await journey(page);
    await selectAnnualPayment(page, label);
  };
}

async function requestReplacementGuid(
  oops: OopsError,
  policyDetailsId: string,
  historyId: number,
  options: QuoteGuidRequestOptions
): Promise<string> {
  try {
    return await requestQuoteGuid(policyDetailsId, historyId, options);
  } catch (error) {
    throw new Error(
      `${oops.message} Requesting a replacement quote GUID failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function templateUrl(template: string, replacements: Record<string, string>): string {
  for (const [name, value] of Object.entries(replacements)) {
    const placeholder = `{${name}}`;
    if (!template.includes(placeholder)) {
      throw new Error(`URL template must contain ${placeholder}.`);
    }

    template = template.replaceAll(placeholder, encodeURIComponent(value));
  }

  const url = new URL(template);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL templates must use http:// or https://.');
  }

  return url.href;
}
