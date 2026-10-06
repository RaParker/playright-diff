import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { color } from './color.js';

/** History ID of every policy that mrp-and-quote's `fetch` saves (it reads one TCAS ID per line, at history 1). */
export const fetchedHistoryId = 1;

/**
 * Runs mrp-and-quote's `fetch` for the first `count` entries of its GUID list.
 * @param projectDir mrp-and-quote project folder.
 * @param count Number of GUID list entries to fetch.
 */
export type MrpFetchRunner = (projectDir: string, count: number) => Promise<void>;

/**
 * Fetches any missing `-mrp.json` files for the given policies with one mrp-and-quote `fetch` run.
 * `fetch` deletes its output folder first and takes only a count, so the count also covers every list entry that
 * already has an MRP file, so none are lost. Policies not in the GUID list cannot be fetched and are only reported, as
 * is an output folder whose parent has no `go.mod` (not the mrp-and-quote project).
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run; nothing is fetched unless it is {@link fetchedHistoryId}.
 * @param guidList mrp-and-quote's GUID list (uppercase), in file order.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder; its parent is the project folder `fetch` runs in.
 * @param runner Runs the fetch (default: `go run . fetch <count>`).
 * @throws When the fetch fails.
 */
export async function prefetchMissingMrpFiles(
  policyDetailsIds: string[],
  historyId: number,
  guidList: string[],
  mrpAndQuoteOutputDir: string,
  runner: MrpFetchRunner = runMrpFetch
): Promise<void> {
  if (historyId !== fetchedHistoryId) {
    return;
  }

  const missing = await filterMissingMrpFiles(policyDetailsIds, mrpAndQuoteOutputDir);
  if (missing.length === 0) {
    return;
  }

  const unlisted = missing.filter((policyDetailsId) => !guidList.includes(policyDetailsId));
  if (unlisted.length > 0) {
    console.log(
      color.Yellow(`MRP files missing for policies not in the GUID list, so not fetched: ${unlisted.join(', ')}`)
    );
  }

  const fetchable = missing.length - unlisted.length;
  if (fetchable === 0) {
    return;
  }

  const projectDir = dirname(resolve(mrpAndQuoteOutputDir));
  if (!(await exists(resolve(projectDir, 'go.mod')))) {
    console.log(
      color.Yellow(`MRP files missing, but ${projectDir} is not the mrp-and-quote project (no go.mod); not fetching.`)
    );
    return;
  }

  const missingFromList = new Set(await filterMissingMrpFiles(guidList, mrpAndQuoteOutputDir));
  const existing = guidList.filter((guid) => !missingFromList.has(guid));
  const count = fetchCountCovering(guidList, [...missing, ...existing]);
  console.log(
    color.Gray(
      `MRP files missing for ${fetchable} policies; fetching the first ${count} GUID list entries with mrp-and-quote in ${projectDir}`
    )
  );
  await runner(projectDir, count);
}

/**
 * Counts the GUID list entries mrp-and-quote's `fetch <count>` must take to include every given policy.
 * @param guidList GUID list (uppercase), in file order.
 * @param policyDetailsIds Policies (uppercase) to include; those not in the list are ignored.
 * @returns One more than the highest list position of any given policy, or 0 when none are in the list.
 */
export function fetchCountCovering(guidList: string[], policyDetailsIds: string[]): number {
  return Math.max(0, ...policyDetailsIds.map((policyDetailsId) => guidList.indexOf(policyDetailsId) + 1));
}

/** Runs `go run . fetch <count>` in the mrp-and-quote project, showing its output, and rejects on a non-zero exit. */
async function runMrpFetch(projectDir: string, count: number): Promise<void> {
  const child = spawn('go', ['run', '.', 'fetch', String(count)], { cwd: projectDir, stdio: 'inherit' });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (code !== 0) {
    throw new Error(`mrp-and-quote fetch ${count} failed with exit code ${code} (${projectDir}).`);
  }
}

/** Returns the policies with no `<policyDetailsId>-1-mrp.json` in the output folder. */
async function filterMissingMrpFiles(policyDetailsIds: string[], mrpAndQuoteOutputDir: string): Promise<string[]> {
  const present = await Promise.all(
    policyDetailsIds.map((policyDetailsId) =>
      exists(resolve(mrpAndQuoteOutputDir, `${policyDetailsId}-${fetchedHistoryId}-mrp.json`))
    )
  );
  return policyDetailsIds.filter((_, index) => present[index] !== true);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}
