import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { color } from './color.js';
import { compare } from './compare.js';
import {
  readQuoteGuidMapping,
  requestQuoteGuid,
  saveQuoteGuidMapping,
  type QuoteGuidRequestOptions
} from './quote-guid.js';
import { removeQuoteOutput } from './quote-output.js';
import { quoteSummary } from './quote-summary.js';
import { DeclinedError, OopsError, screenshot, type ScreenshotOptions } from './screenshot.js';
import { tcasQuote } from './tcas-quote.js';
import { unsavedQuote } from './unsaved-quote.js';

export interface QuotePageOptions {
  mrpAndQuoteOutputDir: string;
  nhiQuotePageUrlTemplate: string;
  tcasQuotePageUrlTemplate: string;
  useOcr?: boolean;
  /** When set, an NHI Oops requests a replacement quote GUID, records it, and retries NHI once. */
  quoteGuidFallback?: QuoteGuidFallbackOptions;
}

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
 * Captures the NHI and TCAS versions of one quote and compares them.
 * @param policyArgument TCAS policy details ID (32 hexadecimal characters).
 * @param historyId TCAS history ID.
 * @param options Input folder, URL templates and the optional NHI Oops fallback.
 * @returns `'compared'`, or `'declined'` when both sides declined to quote (the comparison is skipped).
 * @throws When the inputs are invalid, a capture fails, or only one side declined to quote.
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
  const nhiPath = resolve('screenshots', `${basename}-nhi.png`);
  const tcasPath = resolve('screenshots', `${basename}-tcas.png`);
  const mappingPath = resolve(fallback?.mappingPath ?? 'quote-guid-mapping.json');
  const mappedGuid = fallback === undefined ? undefined : (await readQuoteGuidMapping(mappingPath))[artemisQuoteGuid];
  // Inputs are valid, so clear the previous run's results before writing new ones.
  await removeQuoteOutput(basename, ['nhi', 'tcas']);
  // A mapped replacement means TCAS must wait for NHI to save it; otherwise the original TCAS policy runs alongside.
  const [nhi, originalTcas] = await Promise.allSettled([
    captureNhi(artemisQuoteGuid, mappedGuid, mappingPath, policyDetailsId, historyId, nhiPath, options),
    mappedGuid === undefined
      ? captureAt('TCAS', tcasUrl, { output: tcasPath, beforeCapture: tcasQuote })
      : Promise.resolve(undefined)
  ]);
  let tcas = originalTcas;
  const replacementGuid = nhi.status === 'fulfilled' ? nhi.value.replacementGuid : undefined;
  if (replacementGuid !== undefined && fallback !== undefined) {
    console.log(`TCAS: using replacement quote GUID ${replacementGuid} to match NHI.`);
    const replacementUrl = templateUrl(fallback.tcasReplacementUrlTemplate, { artemisQuoteGuid: replacementGuid });
    [tcas] = await Promise.allSettled([
      captureAt('TCAS', replacementUrl, { output: tcasPath, beforeCapture: quoteSummary('TCAS') })
    ]);
  }

  const captures = [nhi, tcas];
  const failures = captures.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          `${index === 0 ? 'NHI' : 'TCAS'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        ]
      : []
  );
  if (failures.length > 0) {
    throw new Error(`Quote capture failed; comparison skipped.\n${failures.join('\n')}`);
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

  await compare(nhiPath, tcasPath, { useOcr: options.useOcr });
  return 'compared';
}

/**
 * Runs {@link quotePage} for each policy in turn, continuing past failures.
 * @param policyDetailsIds Policy details IDs to capture and compare.
 * @param historyId History ID used for every policy.
 * @param options Options passed to each {@link quotePage} run.
 * @throws After all runs, listing each policy that failed. Policies where both sides declined are not failures.
 */
export async function quotePages(
  policyDetailsIds: string[],
  historyId: number,
  options: QuotePageOptions
): Promise<void> {
  const failures: string[] = [];
  let declined = 0;
  for (const [index, policyDetailsId] of policyDetailsIds.entries()) {
    console.log(`[${index + 1}/${policyDetailsIds.length}] ${policyDetailsId}-${historyId}`);
    try {
      if ((await quotePage(policyDetailsId, historyId, options)) === 'declined') {
        declined++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(color.Red(message));
      failures.push(`${policyDetailsId}-${historyId}: ${message.split('\n').join('; ')}`);
    }
  }

  const passed = policyDetailsIds.length - failures.length;
  const summary = `Quote pages: ${passed} passed (${declined} both declined), ${failures.length} failed.`;
  console.log(failures.length > 0 ? color.Red(summary) : summary);
  if (failures.length > 0) {
    throw new Error(`Quote pages failed:\n${failures.join('\n')}`);
  }
}

async function readQuoteGuid(mrpPath: string): Promise<string> {
  const mrp: unknown = JSON.parse(await readFile(mrpPath, 'utf8'));
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
      beforeCapture: quoteSummary('NHI')
    });
  const fallback = options.quoteGuidFallback;
  if (fallback === undefined) {
    return { outcome: await capture(artemisQuoteGuid) };
  }

  // Replacement quotes exist only in the question set store until the journey's quote button saves them to NHI.
  const captureUnsaved = (quoteGuid: string) =>
    captureAt('NHI', templateUrl(fallback.unsavedQuotePageUrlTemplate, { artemisQuoteGuid: quoteGuid }), {
      output,
      beforeCapture: unsavedQuote
    });
  if (mappedGuid !== undefined) {
    console.log(`NHI: using mapped quote GUID ${mappedGuid} for ${artemisQuoteGuid}.`);
    try {
      return { replacementGuid: mappedGuid, outcome: await capture(mappedGuid) };
    } catch (error) {
      if (!(error instanceof OopsError)) {
        throw error;
      }

      console.log(`NHI: mapped quote GUID ${mappedGuid} is not saved to NHI yet; running its journey.`);
      return { replacementGuid: mappedGuid, outcome: await captureUnsaved(mappedGuid) };
    }
  }

  try {
    return { outcome: await capture(artemisQuoteGuid) };
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
 * Logs the URL a flow opens, captures it, and adds the URL to any failure.
 * @returns `'declined'` when the site declined to quote (its `-declined.png` is saved), otherwise `'captured'`.
 * @throws The capture's error with the URL appended; an {@link OopsError} stays an `OopsError`.
 */
async function captureAt(label: string, url: string, options: ScreenshotOptions): Promise<CaptureOutcome> {
  console.log(`${label}: opening ${url}`);
  try {
    await screenshot(url, options);
    return 'captured';
  } catch (error) {
    if (error instanceof DeclinedError) {
      console.log(`${label}: quote declined (${url}).`);
      return 'declined';
    }

    if (error instanceof OopsError) {
      throw new OopsError(url);
    }

    throw new Error(`${error instanceof Error ? error.message : String(error)} (${url})`, { cause: error });
  }
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
