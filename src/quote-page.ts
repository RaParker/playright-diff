import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compare } from './compare.js';
import {
  readQuoteGuidMapping,
  requestQuoteGuid,
  saveQuoteGuidMapping,
  type QuoteGuidRequestOptions
} from './quote-guid.js';
import { OopsError, screenshot, type ScreenshotOptions } from './screenshot.js';
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

export interface QuoteGuidFallbackOptions extends QuoteGuidRequestOptions {
  /** Mapping JSON file of original to replacement quote GUIDs (default: quote-guid-mapping.json). */
  mappingPath?: string;
  /**
   * Journey URL, with `{artemisQuoteGuid}`, for a replacement quote not yet saved to NHI (`nhi=false`). Driving it
   * to the quote page saves the quote to NHI.
   */
  unsavedQuotePageUrlTemplate: string;
}

export async function quotePage(policyArgument: string, historyId: number, options: QuotePageOptions): Promise<void> {
  if (!/^[0-9a-f]{32}$/i.test(policyArgument)) {
    throw new Error('policyDetailsId must be a UUID with dashes removed (32 hexadecimal characters).');
  }

  const policyDetailsId = policyArgument.toUpperCase();
  if (!Number.isSafeInteger(historyId) || historyId < 0) {
    throw new Error('historyId must be a non-negative safe integer.');
  }

  const basename = `${policyDetailsId}-${historyId}`;
  const artemisQuoteGuid = await readQuoteGuid(resolve(options.mrpAndQuoteOutputDir, `${basename}-mrp.json`));
  // Validate the NHI templates before any capture starts.
  templateUrl(options.nhiQuotePageUrlTemplate, { artemisQuoteGuid });
  if (options.quoteGuidFallback !== undefined) {
    templateUrl(options.quoteGuidFallback.unsavedQuotePageUrlTemplate, { artemisQuoteGuid });
  }

  const tcasUrl = templateUrl(options.tcasQuotePageUrlTemplate, {
    policyDetailsId,
    historyId: String(historyId)
  });
  const nhiPath = resolve('screenshots', `${basename}-nhi.png`);
  const tcasPath = resolve('screenshots', `${basename}-tcas.png`);
  const captures = await Promise.allSettled([
    captureNhi(artemisQuoteGuid, policyDetailsId, historyId, nhiPath, options),
    captureAt('TCAS', tcasUrl, { output: tcasPath, beforeCapture: tcasQuote })
  ]);
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

  await compare(nhiPath, tcasPath, { useOcr: options.useOcr });
}

/**
 * Runs {@link quotePage} for each policy in turn, continuing past failures.
 * @param policyDetailsIds Policy details IDs to capture and compare.
 * @param historyId History ID used for every policy.
 * @param options Options passed to each {@link quotePage} run.
 * @throws After all runs, listing each policy that failed.
 */
export async function quotePages(
  policyDetailsIds: string[],
  historyId: number,
  options: QuotePageOptions
): Promise<void> {
  const failures: string[] = [];
  for (const [index, policyDetailsId] of policyDetailsIds.entries()) {
    console.log(`[${index + 1}/${policyDetailsIds.length}] ${policyDetailsId}-${historyId}`);
    try {
      await quotePage(policyDetailsId, historyId, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      failures.push(`${policyDetailsId}-${historyId}: ${message.split('\n').join('; ')}`);
    }
  }

  const passed = policyDetailsIds.length - failures.length;
  console.log(`Quote pages: ${passed} passed, ${failures.length} failed.`);
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

async function captureNhi(
  artemisQuoteGuid: string,
  policyDetailsId: string,
  historyId: number,
  output: string,
  options: QuotePageOptions
): Promise<void> {
  const capture = (quoteGuid: string) =>
    captureAt('NHI', templateUrl(options.nhiQuotePageUrlTemplate, { artemisQuoteGuid: quoteGuid }), { output });
  const fallback = options.quoteGuidFallback;
  if (fallback === undefined) {
    await capture(artemisQuoteGuid);
    return;
  }

  // Replacement quotes exist only in the question set store until the journey's quote button saves them to NHI.
  const captureUnsaved = (quoteGuid: string) =>
    captureAt('NHI', templateUrl(fallback.unsavedQuotePageUrlTemplate, { artemisQuoteGuid: quoteGuid }), {
      output,
      beforeCapture: unsavedQuote
    });
  const mappingPath = resolve(fallback.mappingPath ?? 'quote-guid-mapping.json');
  const mappedGuid = (await readQuoteGuidMapping(mappingPath))[artemisQuoteGuid];
  if (mappedGuid !== undefined) {
    console.log(`NHI: using mapped quote GUID ${mappedGuid} for ${artemisQuoteGuid}.`);
    try {
      await capture(mappedGuid);
    } catch (error) {
      if (!(error instanceof OopsError)) {
        throw error;
      }

      console.log(`NHI: mapped quote GUID ${mappedGuid} is not saved to NHI yet; running its journey.`);
      await captureUnsaved(mappedGuid);
    }

    return;
  }

  try {
    await capture(artemisQuoteGuid);
  } catch (error) {
    if (!(error instanceof OopsError)) {
      throw error;
    }

    const replacementGuid = await requestReplacementGuid(error, policyDetailsId, historyId, fallback);
    await saveQuoteGuidMapping(mappingPath, artemisQuoteGuid, replacementGuid);
    console.log(
      `NHI: mapped ${artemisQuoteGuid} to new quote GUID ${replacementGuid} in ${mappingPath}; running its journey.`
    );
    await captureUnsaved(replacementGuid);
  }
}

/**
 * Logs the URL a flow opens, captures it, and adds the URL to any failure.
 * @throws The capture's error with the URL appended; an {@link OopsError} stays an `OopsError`.
 */
async function captureAt(label: string, url: string, options: ScreenshotOptions): Promise<void> {
  console.log(`${label}: opening ${url}`);
  try {
    await screenshot(url, options);
  } catch (error) {
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
