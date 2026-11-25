import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { color } from './color.js';

/** File mrp-and-quote writes to its output folder listing the quotes a fetch failed on. */
export const failedElementsReportName = 'failed-elements.txt';

/** History ID of every policy that mrp-and-quote's `fetch` saves (it reads one TCAS ID per line, at history 1). */
export const fetchedHistoryId = 1;

/** Where mrp-and-quote's files are saved, the project that saves them, and the environment it fetches from. */
export interface MrpAndQuoteFolders {
  /** Folder the `-mrp.json` files are read from, and that `fetch` saves into (`OUTPUT_DIR/<environment>/mrp-and-quote`). */
  outputDir: string;
  /** mrp-and-quote project folder `fetch` runs in (`MRP_AND_QUOTE_PROJECT_DIR`); needed only when files are missing. */
  projectDir?: string;
  /**
   * Environment `fetch` reads MRP data from, e.g. `dev` (`QUOTE_JOURNEY_ENVIRONMENT`), passed as its
   * `SOURCE_ENVIRONMENT`; when not set, mrp-and-quote's own `.env` decides.
   */
  sourceEnvironment?: string;
}

/**
 * Runs mrp-and-quote's `fetch` for the given GUID list entries, keeping the files already in its output folder.
 * @param projectDir mrp-and-quote project folder.
 * @param outputDir Folder the fetched files must be saved in.
 * @param policyDetailsIds GUID list entries to fetch.
 * @param sourceEnvironment Environment to fetch from, or undefined to leave it to mrp-and-quote's `.env`.
 */
export type MrpFetchRunner = (
  projectDir: string,
  outputDir: string,
  policyDetailsIds: string[],
  sourceEnvironment?: string
) => Promise<void>;

/**
 * Fetches any missing `-mrp.json` files for the given policies with one mrp-and-quote `fetch --keep-output` run, so
 * only those policies are fetched and every existing file is kept. Policies not in the GUID list cannot be fetched and
 * are only reported. A fetch that fails on quotes (mrp-and-quote writes {@link failedElementsReportName}) is only
 * reported too, so those policies fail individually; mrp-and-quote not running at all stops the run.
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run; nothing is fetched unless it is {@link fetchedHistoryId}.
 * @param guidList mrp-and-quote's GUID list (uppercase), in file order.
 * @param folders mrp-and-quote's output folder, the project folder `fetch` runs in, and the environment it fetches from.
 * @param runner Runs the fetch (default: `go run . fetch --guid-file <file> --keep-output`, with `OUTPUT_DIR` set to
 * the output folder and `SOURCE_ENVIRONMENT` to the environment).
 * @throws When files are missing and no project folder is given, the project folder has no `go.mod`, or the fetch
 * fails without writing {@link failedElementsReportName} (it did not build, start or reach the quotes).
 */
export async function prefetchMissingMrpFiles(
  policyDetailsIds: string[],
  historyId: number,
  guidList: string[],
  folders: MrpAndQuoteFolders,
  runner: MrpFetchRunner = runMrpFetch
): Promise<void> {
  if (historyId !== fetchedHistoryId) {
    return;
  }

  const missing = await filterMissingMrpFiles(policyDetailsIds, folders.outputDir);
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

  if (folders.projectDir === undefined) {
    throw new Error(
      `${fetchable.length} MRP files are missing and MRP_AND_QUOTE_PROJECT_DIR is not set, so they cannot be fetched. ` +
        'Set it in .env to the mrp-and-quote project, or run with --no-fetch.'
    );
  }

  const outputDir = resolve(folders.outputDir);
  const projectDir = resolve(folders.projectDir);
  if (!(await exists(resolve(projectDir, 'go.mod')))) {
    throw new Error(
      `MRP_AND_QUOTE_PROJECT_DIR (${projectDir}) is not the mrp-and-quote project (no go.mod), so ${fetchable.length} ` +
        'missing MRP files cannot be fetched. Fix it in .env, or run with --no-fetch.'
    );
  }

  console.log(color.Gray(`Fetching ${fetchable.length} missing MRP files with mrp-and-quote in ${projectDir}`));
  // With --keep-output mrp-and-quote leaves an earlier report in place, which would pass for one from this fetch.
  const reportPath = resolve(outputDir, failedElementsReportName);
  await rm(reportPath, { force: true });
  try {
    await runner(projectDir, outputDir, fetchable, folders.sourceEnvironment);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // mrp-and-quote writes the report only once it has tried the quotes (it exits non-zero only when all of them fail),
    // so with no report it did not build, start or get that far, and no policy can be compared.
    if (!(await exists(reportPath))) {
      throw new Error(
        `${message} mrp-and-quote did not run, so the run is stopped; see its output above (e.g. run its ` +
          'GetAzurePackages.ps1 when packages are missing), or run with --no-fetch to use only the saved MRP files.',
        { cause: error }
      );
    }

    console.log(
      color.Yellow(`${message} Quotes it could not fetch are listed in ${reportPath}; continuing, and they will fail.`)
    );
  }
}

/**
 * Reports, without fetching, how many of the given policies have no saved MRP file (`quote-pages -- --no-fetch`), so
 * the failures they will cause are expected.
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run; nothing is checked unless it is {@link fetchedHistoryId}, as with
 * {@link prefetchMissingMrpFiles}.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder.
 */
export async function reportMissingMrpFiles(
  policyDetailsIds: string[],
  historyId: number,
  mrpAndQuoteOutputDir: string
): Promise<void> {
  if (historyId !== fetchedHistoryId) {
    return;
  }

  const missing = await filterMissingMrpFiles(policyDetailsIds, mrpAndQuoteOutputDir);
  if (missing.length > 0) {
    console.log(
      color.Yellow(
        `${missing.length} of ${policyDetailsIds.length} policies have no MRP file and will fail; not fetching (--no-fetch).`
      )
    );
  }
}

/**
 * Finds the policies whose MRP record mrp-and-quote has not saved.
 * @param policyDetailsIds Policies to check.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder.
 * @returns The policies with no `<policyDetailsId>-1-mrp.json` in the output folder, in the given order.
 */
export async function filterMissingMrpFiles(
  policyDetailsIds: string[],
  mrpAndQuoteOutputDir: string
): Promise<string[]> {
  const present = await Promise.all(
    policyDetailsIds.map((policyDetailsId) =>
      exists(resolve(mrpAndQuoteOutputDir, `${policyDetailsId}-${fetchedHistoryId}-mrp.json`))
    )
  );
  return policyDetailsIds.filter((_, index) => present[index] !== true);
}

/**
 * Builds the environment of a `fetch` run: this process's, with `OUTPUT_DIR` set to the output folder and, when given,
 * `SOURCE_ENVIRONMENT` to the source environment in upper case (e.g. `TST`). mrp-and-quote loads its own `.env`
 * without overriding variables already set, so the files are saved where they are read from, and fetched from the
 * same environment as the quote pages, whatever its `.env` says.
 * @param outputDir Folder the fetched files must be saved in.
 * @param environment Environment to start from (default: this process's).
 * @param sourceEnvironment Environment to fetch from, e.g. `tst`; when undefined, `SOURCE_ENVIRONMENT` is left as is.
 * @returns A new environment; the given one is not changed.
 */
export function mrpFetchEnvironment(
  outputDir: string,
  environment = process.env,
  sourceEnvironment?: string
): NodeJS.ProcessEnv {
  const fetchEnvironment: NodeJS.ProcessEnv = { ...environment, OUTPUT_DIR: resolve(outputDir) };
  if (sourceEnvironment !== undefined) {
    fetchEnvironment['SOURCE_ENVIRONMENT'] = sourceEnvironment.toUpperCase();
  }

  return fetchEnvironment;
}

/**
 * Writes the policies to a temporary GUID file (one per line) and runs `go run . fetch --guid-file <file> --keep-output`
 * in the mrp-and-quote project, with {@link mrpFetchEnvironment}, showing its output. The file keeps long lists off the command line and is always
 * removed afterwards. Rejects on a non-zero exit.
 */
async function runMrpFetch(
  projectDir: string,
  outputDir: string,
  policyDetailsIds: string[],
  sourceEnvironment?: string
): Promise<void> {
  const guidFileDir = await mkdtemp(join(tmpdir(), 'mrp-fetch-guids-'));
  try {
    const guidFile = join(guidFileDir, 'missing-guids.txt');
    await writeFile(guidFile, `${policyDetailsIds.join('\n')}\n`);
    const child = spawn('go', ['run', '.', 'fetch', '--guid-file', guidFile, '--keep-output'], {
      cwd: projectDir,
      env: mrpFetchEnvironment(outputDir, process.env, sourceEnvironment),
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}
