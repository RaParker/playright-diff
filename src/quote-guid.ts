import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readOptionalTextFile, retryWhileBusy } from './fs-helpers.js';

/**
 * The latest pending read or update of each mapping file (by absolute path). Each one waits for the one before, so
 * policies running at once never read a file mid-write or overwrite each other's new entries.
 */
const mappingQueues = new Map<string, Promise<unknown>>();

export interface QuoteGuidRequestOptions {
  quoteGuidUrl: string;
  agentId: string;
  branchCode: string;
  callMediaUser: string;
  timeout?: number;
}

/**
 * Requests a replacement NHI quote GUID with the TCAS policy's answers copied onto it, posting today's (local) date
 * as the cover start date — without one, the endpoint keeps the policy's original cover start date, which the journey
 * may then reject.
 * @param policyDetailsId TCAS policy details ID whose answers are copied.
 * @param historyId TCAS history ID whose answers are copied.
 * @param options Endpoint URL and agent details sent with the request.
 * @returns The new quote GUID.
 * @throws When the request fails, returns a non-2xx status, or omits a `guid` string.
 */
export async function requestQuoteGuid(
  policyDetailsId: string,
  historyId: number,
  options: QuoteGuidRequestOptions
): Promise<string> {
  const url = new URL(options.quoteGuidUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Quote GUID URL must use http:// or https://.');
  }

  url.searchParams.set('agentId', options.agentId);
  url.searchParams.set('branchCode', options.branchCode);
  url.searchParams.set('callMediaUser', options.callMediaUser);
  url.searchParams.set('policyDetailsId', policyDetailsId);
  url.searchParams.set('historyId', String(historyId));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coverStartDate: todayIsoDate() }),
    signal: AbortSignal.timeout(options.timeout ?? 30000)
  });
  if (!response.ok) {
    throw new Error(`Quote GUID request returned HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object' || !('guid' in body)) {
    throw new Error('Quote GUID response must contain the "guid" property.');
  }

  const guid = body['guid'];
  if (typeof guid !== 'string' || guid.trim().length === 0) {
    throw new Error('Quote GUID response "guid" must be a non-empty string.');
  }

  return guid;
}

/**
 * Reads the mapping of original quote GUIDs to their replacements, after any pending update of the file.
 * @param path Mapping JSON file path.
 * @returns The mapping, or an empty mapping when the file does not exist.
 * @throws When the file cannot be read or is not a JSON object of strings.
 */
export async function readQuoteGuidMapping(path: string): Promise<Record<string, string>> {
  return withMappingQueue(path, () => readMappingFile(path));
}

/**
 * Records a replacement quote GUID against the original, keeping existing entries. Updates of the same file run one
 * at a time, and each replaces the file in one step (a temporary file renamed over it), so no entry is lost and no
 * reader sees a partly written file.
 * @param path Mapping JSON file path.
 * @param originalGuid Quote GUID that displayed Oops.
 * @param replacementGuid Quote GUID to use instead.
 * @throws When the existing mapping is invalid or the file cannot be written.
 */
export async function saveQuoteGuidMapping(path: string, originalGuid: string, replacementGuid: string): Promise<void> {
  await withMappingQueue(path, async () => {
    const mapping = await readMappingFile(path);
    mapping[originalGuid] = replacementGuid;
    await mkdir(dirname(path), { recursive: true });
    await replaceFile(path, `${JSON.stringify(mapping, null, 2)}\n`);
  });
}

/** Runs a read or update of a mapping file once every earlier one queued for the same file has settled. */
async function withMappingQueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(path);
  const result = (mappingQueues.get(key) ?? Promise.resolve()).then(task, task);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  mappingQueues.set(key, settled);
  try {
    return await result;
  } finally {
    // Forget the file once nothing else is queued for it.
    if (mappingQueues.get(key) === settled) {
      mappingQueues.delete(key);
    }
  }
}

async function readMappingFile(path: string): Promise<Record<string, string>> {
  const content = await readOptionalTextFile(path);
  if (content === undefined) {
    return {};
  }

  const mapping: unknown = JSON.parse(content);
  if (
    mapping === null ||
    typeof mapping !== 'object' ||
    Array.isArray(mapping) ||
    !Object.values(mapping).every((value) => typeof value === 'string')
  ) {
    throw new Error(`Quote GUID mapping must be a JSON object of strings: ${path}`);
  }

  return mapping as Record<string, string>;
}

/**
 * Writes the content to a temporary file beside the target, then renames it over the target, retrying while another
 * process (such as a virus scanner) briefly holds the target open.
 */
async function replaceFile(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content);
    await retryWhileBusy(() => rename(temporaryPath, path));
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Today's local date as `YYYY-MM-DD`. */
function todayIsoDate(): string {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}
