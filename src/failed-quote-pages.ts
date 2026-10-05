import { readFile, rm, writeFile } from 'node:fs/promises';

/** File, in the current working directory, listing the policies that failed in the last quote-pages run. */
export const failedQuotePagesPath = 'quote-pages-failed.json';

/** A policy that failed in a quote-pages run, with the issues reported for it. */
export interface FailedQuotePage {
  policyDetailsId: string;
  issues: string[];
}

/** The failed policies of one quote-pages run, all sharing its history ID. */
export interface FailedQuotePages {
  historyId: number;
  failed: FailedQuotePage[];
}

/**
 * Replaces the failed-policies file with the failures of the latest run, or deletes it when none failed.
 * @param path File path.
 * @param failures The run's history ID and failed policies.
 * @throws When the file cannot be written or deleted.
 */
export async function writeFailedQuotePages(path: string, failures: FailedQuotePages): Promise<void> {
  if (failures.failed.length === 0) {
    await rm(path, { force: true });
    return;
  }

  await writeFile(path, `${JSON.stringify(failures, null, 2)}\n`);
}

/**
 * Reads the failed policies saved by the last quote-pages run.
 * @param path File path.
 * @returns The saved failures, or `undefined` when the file does not exist.
 * @throws When the file cannot be read or is not a failed-policies list.
 */
export async function readFailedQuotePages(path: string): Promise<FailedQuotePages | undefined> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }

  const saved: unknown = JSON.parse(content);
  if (!isFailedQuotePages(saved)) {
    throw new Error(
      `Failed quote pages must be {"historyId": <integer>, "failed": [{"policyDetailsId": "<32 hex>", "issues": [...]}]}: ${path}`
    );
  }

  return {
    historyId: saved.historyId,
    failed: saved.failed.map((entry) => ({ ...entry, policyDetailsId: entry.policyDetailsId.toUpperCase() }))
  };
}

function isFailedQuotePages(value: unknown): value is FailedQuotePages {
  if (value === null || typeof value !== 'object' || !('historyId' in value) || !('failed' in value)) {
    return false;
  }

  return (
    typeof value.historyId === 'number' &&
    Number.isSafeInteger(value.historyId) &&
    value.historyId >= 0 &&
    Array.isArray(value.failed) &&
    value.failed.every(isFailedQuotePage)
  );
}

function isFailedQuotePage(value: unknown): value is FailedQuotePage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'policyDetailsId' in value &&
    typeof value.policyDetailsId === 'string' &&
    /^[0-9a-f]{32}$/i.test(value.policyDetailsId) &&
    'issues' in value &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => typeof issue === 'string')
  );
}
