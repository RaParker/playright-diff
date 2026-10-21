import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseJson, readOptionalTextFile, replaceFile } from './fs-helpers.js';
import { outputPath } from './output-paths.js';

/** File name of the result each quote-page run writes into its `<policyDetailsId>-<historyId>` output folder. */
export const quoteResultFileName = 'result.json';

/** How a quote-page run ended: compared, both sides declined, or failed. */
export type QuoteOutcome = 'compared' | 'declined' | 'failed';

/** The endorsement titles each flow's quote page listed, in the order shown before it was standardised. */
export interface EndorsementOrder {
  nhi: string[];
  tcas: string[];
}

/** The saved result of one quote-page run, read back by the summarise command. */
export interface QuoteResult {
  policyDetailsId: string;
  historyId: number;
  outcome: QuoteOutcome;
  /** True when every failed capture stopped on a journey validation error (shown in yellow). */
  validation: boolean;
  /** The failure message, one line per entry; empty unless the run failed. */
  issues: string[];
  /**
   * Set only when the quote pages were compared and listed the endorsements differently. The screenshots show them in
   * standard order, so a difference in order alone does not show up in the comparison.
   */
  endorsementOrder?: EndorsementOrder;
  /** ISO 8601 time the run started; failure pages older than this are from an earlier run. */
  startedAt: string;
  /** ISO 8601 time the run finished. */
  finishedAt: string;
}

/**
 * Writes a quote-page run's result to `<policyDetailsId>-<historyId>/result.json`, creating the folder when the
 * run stopped before capturing.
 * @param result The run's result.
 * @param root Folder holding the policy folders (default: the output folder, see {@link outputPath}).
 * @throws When the folder or file cannot be written.
 */
export async function writeQuoteResult(result: QuoteResult, root = outputPath()): Promise<void> {
  const directory = resolve(root, `${result.policyDetailsId}-${result.historyId}`);
  await mkdir(directory, { recursive: true });
  await replaceFile(join(directory, quoteResultFileName), `${JSON.stringify(result, null, 2)}\n`);
}

/**
 * Reads the result a quote-page run saved in a policy's output folder.
 * @param directory The policy's output folder.
 * @returns The result, or `undefined` when the folder has no `result.json`.
 * @throws When the file cannot be read or is not a quote result.
 */
export async function readQuoteResult(directory: string): Promise<QuoteResult | undefined> {
  const path = join(directory, quoteResultFileName);
  const content = await readOptionalTextFile(path);
  if (content === undefined) {
    return undefined;
  }

  const result = parseJson(content, path);
  if (!isQuoteResult(result)) {
    throw new Error(
      `Quote result must be {"policyDetailsId", "historyId", "outcome": "compared"|"declined"|"failed", "validation", "issues", "startedAt", "finishedAt"}: ${path}`
    );
  }

  return result;
}

function isQuoteResult(value: unknown): value is QuoteResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'policyDetailsId' in value &&
    typeof value.policyDetailsId === 'string' &&
    'historyId' in value &&
    typeof value.historyId === 'number' &&
    'outcome' in value &&
    (value.outcome === 'compared' || value.outcome === 'declined' || value.outcome === 'failed') &&
    'validation' in value &&
    typeof value.validation === 'boolean' &&
    'issues' in value &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => typeof issue === 'string') &&
    'startedAt' in value &&
    typeof value.startedAt === 'string' &&
    'finishedAt' in value &&
    typeof value.finishedAt === 'string' &&
    (!('endorsementOrder' in value) || isEndorsementOrder(value.endorsementOrder))
  );
}

function isEndorsementOrder(value: unknown): value is EndorsementOrder {
  return (
    value !== null &&
    typeof value === 'object' &&
    'nhi' in value &&
    isStringArray(value.nhi) &&
    'tcas' in value &&
    isStringArray(value.tcas)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
