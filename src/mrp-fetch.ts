import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { color } from './color.js';

/** History ID of every policy that mrp-and-quote's `fetch` saves (it reads one TCAS ID per line, at history 1). */
export const fetchedHistoryId = 1;

/**
 * Runs mrp-and-quote's `fetch` for the given GUID list entries, keeping the files already in its output folder.
 * @param projectDir mrp-and-quote project folder.
 * @param policyDetailsIds GUID list entries to fetch.
 */
export type MrpFetchRunner = (projectDir: string, policyDetailsIds: string[]) => Promise<void>;

/**
 * Fetches any missing `-mrp.json` files for the given policies with one mrp-and-quote `fetch --keep-output` run, so
 * only those policies are fetched and every existing file is kept. Policies not in the GUID list cannot be fetched and
 * are only reported, as is an output folder whose parent has no `go.mod` (not the mrp-and-quote project).
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run; nothing is fetched unless it is {@link fetchedHistoryId}.
 * @param guidList mrp-and-quote's GUID list (uppercase), in file order.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder; its parent is the project folder `fetch` runs in.
 * @param runner Runs the fetch (default: `go run . fetch --guid-file <file> --keep-output`). A failed fetch is only
 * reported, so the run continues.
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

  const fetchable = missing.filter((policyDetailsId) => guidList.includes(policyDetailsId));
  if (fetchable.length === 0) {
    return;
  }

  const projectDir = dirname(resolve(mrpAndQuoteOutputDir));
  if (!(await exists(resolve(projectDir, 'go.mod')))) {
    console.log(
      color.Yellow(`MRP files missing, but ${projectDir} is not the mrp-and-quote project (no go.mod); not fetching.`)
    );
    return;
  }

  console.log(color.Gray(`Fetching ${fetchable.length} missing MRP files with mrp-and-quote in ${projectDir}`));
  try {
    await runner(projectDir, fetchable);
  } catch (error) {
    // A quote without a saved MRP fails the whole fetch; warn and carry on so the other policies still run, while
    // those without an MRP file fail individually.
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.Yellow(`${message} Continuing; policies still missing an MRP file will fail.`));
  }
}

/**
 * Writes the policies to a temporary GUID file (one per line) and runs `go run . fetch --guid-file <file> --keep-output`
 * in the mrp-and-quote project, showing its output. The file keeps long lists off the command line and is always
 * removed afterwards. Rejects on a non-zero exit.
 */
async function runMrpFetch(projectDir: string, policyDetailsIds: string[]): Promise<void> {
  const guidFileDir = await mkdtemp(join(tmpdir(), 'mrp-fetch-guids-'));
  try {
    const guidFile = join(guidFileDir, 'missing-guids.txt');
    await writeFile(guidFile, `${policyDetailsIds.join('\n')}\n`);
    const child = spawn('go', ['run', '.', 'fetch', '--guid-file', guidFile, '--keep-output'], {
      cwd: projectDir,
      stdio: 'inherit'
    });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    if (code !== 0) {
      throw new Error(
        `mrp-and-quote fetch of ${policyDetailsIds.length} policies failed with exit code ${code} (${projectDir}).`
      );
    }
  } finally {
    await rm(guidFileDir, { recursive: true, force: true });
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
