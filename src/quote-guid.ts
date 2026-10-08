import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
 * Reads the mapping of original quote GUIDs to their replacements.
 * @param path Mapping JSON file path.
 * @returns The mapping, or an empty mapping when the file does not exist.
 * @throws When the file cannot be read or is not a JSON object of strings.
 */
export async function readQuoteGuidMapping(path: string): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }

    throw error;
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
 * Records a replacement quote GUID against the original, keeping existing entries.
 * @param path Mapping JSON file path.
 * @param originalGuid Quote GUID that displayed Oops.
 * @param replacementGuid Quote GUID to use instead.
 * @throws When the existing mapping is invalid or the file cannot be written.
 */
export async function saveQuoteGuidMapping(path: string, originalGuid: string, replacementGuid: string): Promise<void> {
  const mapping = await readQuoteGuidMapping(path);
  mapping[originalGuid] = replacementGuid;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(mapping, null, 2)}\n`);
}

/** Today's local date as `YYYY-MM-DD`. */
function todayIsoDate(): string {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}
