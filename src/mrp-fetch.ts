import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { color } from './color.js';

/** History ID of every policy that mrp-and-quote's `fetch` saves (it reads one TCAS ID per line, at history 1). */
export const fetchedHistoryId = 1;

/** Where mrp-and-quote's files are saved, and the project that saves them. */
export interface MrpAndQuoteFolders {
  /** Output folder the `-mrp.json` files are read from, and that `fetch` saves into (`MRP_AND_QUOTE_OUTPUT_DIR`). */
  outputDir: string;
  /**
   * mrp-and-quote project folder `fetch` runs in (`MRP_AND_QUOTE_PROJECT_DIR`); defaults to the output folder's parent,
   * which suits mrp-and-quote's default `./output`.
   */
  projectDir?: string;
}

/**
 * Runs mrp-and-quote's `fetch` for the given GUID list entries, keeping the files already in its output folder.
 * @param projectDir mrp-and-quote project folder.
 * @param outputDir Folder the fetched files must be saved in.
 * @param policyDetailsIds GUID list entries to fetch.
 */
export type MrpFetchRunner = (projectDir: string, outputDir: string, policyDetailsIds: string[]) => Promise<void>;

/**
 * Fetches any missing `-mrp.json` files for the given policies with one mrp-and-quote `fetch --keep-output` run, so
 * only those policies are fetched and every existing file is kept. Policies not in the GUID list cannot be fetched and
 * are only reported, as is a project folder with no `go.mod` (not the mrp-and-quote project).
 * @param policyDetailsIds Policies about to run.
 * @param historyId History ID of the run; nothing is fetched unless it is {@link fetchedHistoryId}.
 * @param guidList mrp-and-quote's GUID list (uppercase), in file order.
 * @param folders mrp-and-quote's output folder, and the project folder `fetch` runs in.
 * @param runner Runs the fetch (default: `go run . fetch --guid-file <file> --keep-output`, with `OUTPUT_DIR` set to
 * the output folder). A failed fetch is only reported, so the run continues.
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

  const outputDir = resolve(folders.outputDir);
  const projectDir = resolve(folders.projectDir ?? dirname(outputDir));
  if (!(await exists(resolve(projectDir, 'go.mod')))) {
    console.log(
      color.Yellow(`MRP files missing, but ${projectDir} is not the mrp-and-quote project (no go.mod); not fetching.`)
    );
    return;
  }

  console.log(color.Gray(`Fetching ${fetchable.length} missing MRP files with mrp-and-quote in ${projectDir}`));
  try {
    await runner(projectDir, outputDir, fetchable);
  } catch (error) {
    // A quote without a saved MRP fails the whole fetch; warn and carry on so the other policies still run, while
    // those without an MRP file fail individually.
    const message = error instanceof Error ? error.message : String(error);
    console.log(color.Yellow(`${message} Continuing; policies still missing an MRP file will fail.`));
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
 * Builds the environment of a `fetch` run: this process's, with `OUTPUT_DIR` set to the output folder. mrp-and-quote
 * loads its own `.env` without overriding variables already set, so the files are saved where they are read from
 * whatever its `.env` says.
 * @param outputDir Folder the fetched files must be saved in.
 * @param environment Environment to start from (default: this process's).
 * @returns A new environment; the given one is not changed.
 */
export function mrpFetchEnvironment(outputDir: string, environment = process.env): NodeJS.ProcessEnv {
  return { ...environment, OUTPUT_DIR: resolve(outputDir) };
}

/**
 * Writes the policies to a temporary GUID file (one per line) and runs `go run . fetch --guid-file <file> --keep-output`
 * in the mrp-and-quote project, with {@link mrpFetchEnvironment}, showing its output. The file keeps long lists off the command line and is always
 * removed afterwards. Rejects on a non-zero exit.
 */
async function runMrpFetch(projectDir: string, outputDir: string, policyDetailsIds: string[]): Promise<void> {
  const guidFileDir = await mkdtemp(join(tmpdir(), 'mrp-fetch-guids-'));
  try {
    const guidFile = join(guidFileDir, 'missing-guids.txt');
    await writeFile(guidFile, `${policyDetailsIds.join('\n')}\n`);
    const child = spawn('go', ['run', '.', 'fetch', '--guid-file', guidFile, '--keep-output'], {
      cwd: projectDir,
      env: mrpFetchEnvironment(outputDir),
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
