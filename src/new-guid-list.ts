import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isQuoteGuid } from './quote-guid-list.js';
import { readOptionalTextFile } from './fs-helpers.js';

/** Policies a new GUID list holds when no count is given: enough for several default (250) quote-pages runs. */
export const defaultNewGuidListCount = 1000;

/** The query that picks the policies, run with sqlcmd from its own folder. */
const queryFile = 'quote-guids.sql';
const queryFolder = fileURLToPath(new URL('../sql/', import.meta.url));

/** Candidates queried for each policy wanted, as some have no TCAS policy. */
const candidatesPerPolicy = 3;
/** Policy API checks run at once. */
const checkConcurrency = 10;
/**
 * Candidates in a row without a TCAS policy after which checking stops: the query lists likely ones first, so a long
 * run of misses means the rest (bulk aggregator quotes on stg and tst) are unlikely to have one either.
 */
export const maxConsecutiveMisses = 200;
/** Policy API request timeout in milliseconds. */
const policyApiTimeoutMs = 30_000;

/** Policy API statuses: the policy exists, or TCAS has no such policy. */
const httpOk = 200;
const httpNotFound = 404;

/** sqlcmd's login timeout in seconds; the query itself gets {@link queryTimeoutSeconds}. */
const loginTimeoutSeconds = 30;
const queryTimeoutSeconds = 300;

/** Where and how to make a GUID list. */
export interface NewGuidListOptions {
  /** File to write (`QUOTE_GUID_LIST_PATH`), e.g. testdata/quoteGuids-stg.txt. */
  listPath: string;
  /** Environment the list is for (`QUOTE_JOURNEY_ENVIRONMENT`), written to its header. */
  environment: string;
  /** SQL Server host of the environment's NHI database (`QUOTE_GUID_DB_SERVER`). */
  server: string;
  /** NHI applications database name (`QUOTE_GUID_DB_NAME`). */
  database: string;
  /**
   * Policy API URL with a `{policyDetailsId}` placeholder (`QUOTE_GUID_POLICY_API_URL`), e.g.
   * `https://wkservices-stg.avantiagroup.co.uk/policyapiservice/api/policy/{policyDetailsId}/1`: candidates it answers
   * 404 for have no TCAS policy and are left out.
   */
  policyApiUrlTemplate: string;
  /** Number of policies to list. */
  maxCount: number;
  /** Replace an existing list. */
  force: boolean;
  /** When the list is made (default: now), for its header. */
  now?: Date;
}

/**
 * Checks whether TCAS has the policy.
 * @returns `true` when it does, `false` when it does not.
 * @throws When the answer is neither, such as a server error.
 */
export type PolicyCheck = (policyDetailsId: string) => Promise<boolean>;

/** How {@link createQuoteGuidList} reaches sqlcmd and the Policy API (replaced in tests). */
export interface NewGuidListServices {
  runSqlcmd: SqlcmdRunner;
  /** Builds the check from the URL template (default: {@link policyApiCheck}). */
  policyCheck: (urlTemplate: string) => PolicyCheck;
  /** Progress messages (default: `console.log`). */
  log: (message: string) => void;
}

/**
 * Runs sqlcmd with the given arguments from the given folder.
 * @returns Its standard output.
 * @throws When sqlcmd cannot be started or exits with an error.
 */
export type SqlcmdRunner = (args: string[], cwd: string) => Promise<string>;

/** The real sqlcmd, Policy API and console. */
const defaultServices: NewGuidListServices = {
  runSqlcmd: runSqlcmdProcess,
  policyCheck: policyApiCheck,
  log: (message) => console.log(message)
};

/**
 * Makes a GUID list from an environment's NHI database: runs sql/quote-guids.sql with sqlcmd (Windows authentication)
 * for candidates, keeps those the Policy API finds (in the query's order) up to `maxCount`, and writes them under a
 * header naming the environment, so quote-pages can refuse the list in another environment.
 * @param options Where and how to make the list.
 * @param services sqlcmd, the Policy API and logging (default: the real ones).
 * @returns The number of policies written.
 * @throws When the list exists and `force` is not set, the query fails or returns anything but policy IDs, a Policy
 * API check fails, or no candidate has a TCAS policy (the file is then left as it was).
 */
export async function createQuoteGuidList(
  options: NewGuidListOptions,
  services: Partial<NewGuidListServices> = {}
): Promise<number> {
  const { runSqlcmd, policyCheck, log } = { ...defaultServices, ...services };
  if (!options.force && (await readOptionalTextFile(options.listPath)) !== undefined) {
    throw new Error(`${options.listPath} already exists. Pass --force (Run-Project.ps1 -Force) to replace it.`);
  }

  const candidates = parseQueryOutput(await runSqlcmd(sqlcmdArguments(options), queryFolder));
  log(`${candidates.length} candidates; checking them with the Policy API…`);
  const policyDetailsIds = await selectExistingPolicies(
    candidates,
    options.maxCount,
    policyCheck(options.policyApiUrlTemplate),
    log
  );
  if (policyDetailsIds.length === 0) {
    throw new Error(
      `None of the ${candidates.length} candidates from ${options.server}/${options.database} has a TCAS policy; ` +
        `${options.listPath} is unchanged.`
    );
  }

  await mkdir(dirname(options.listPath), { recursive: true });
  await writeFile(options.listPath, formatQuoteGuidList(options, policyDetailsIds));
  return policyDetailsIds.length;
}

/**
 * Keeps the candidates TCAS has, in order, checking {@link checkConcurrency} at a time.
 * @param candidates Policy details IDs, most wanted first.
 * @param maxCount Most to keep.
 * @param check Whether TCAS has a policy.
 * @param log Progress messages.
 * @returns Up to `maxCount` IDs. Checking stops early after {@link maxConsecutiveMisses} misses in a row.
 * @throws When a check fails.
 */
export async function selectExistingPolicies(
  candidates: string[],
  maxCount: number,
  check: PolicyCheck,
  log: (message: string) => void = () => undefined
): Promise<string[]> {
  const kept: string[] = [];
  let misses = 0;
  for (let start = 0; start < candidates.length && kept.length < maxCount; start += checkConcurrency) {
    const batch = candidates.slice(start, start + checkConcurrency);
    const found = await Promise.all(batch.map((policyDetailsId) => check(policyDetailsId)));
    for (const [index, policyDetailsId] of batch.entries()) {
      misses = found[index] === true ? 0 : misses + 1;
      if (found[index] === true && kept.length < maxCount) {
        kept.push(policyDetailsId);
      }
    }

    log(`  checked ${start + batch.length}, kept ${kept.length}`);
    if (misses >= maxConsecutiveMisses) {
      log(`  stopped: the last ${misses} candidates have no TCAS policy`);
      break;
    }
  }

  return kept;
}

/**
 * Checks policies with the Policy API: 200 means TCAS has the policy, 404 that it does not.
 * @param urlTemplate URL with a `{policyDetailsId}` placeholder.
 * @returns The check, which throws on any other status or a network error.
 */
export function policyApiCheck(urlTemplate: string): PolicyCheck {
  return async (policyDetailsId) => {
    const url = urlTemplate.replace('{policyDetailsId}', policyDetailsId);
    const response = await fetch(url, { signal: AbortSignal.timeout(policyApiTimeoutMs) });
    await response.body?.cancel();
    if (response.status === httpOk || response.status === httpNotFound) {
      return response.status === httpOk;
    }

    throw new Error(`Policy API answered ${response.status} for ${url}.`);
  };
}

/**
 * Builds sqlcmd's arguments: Windows authentication (`-E`), errors as a non-zero exit (`-b`), and bare rows (no
 * headers, trimmed) so each line of output is one policy ID.
 */
export function sqlcmdArguments(options: Pick<NewGuidListOptions, 'server' | 'database' | 'maxCount'>): string[] {
  return [
    ...['-S', options.server, '-d', options.database, '-E', '-b'],
    ...['-l', `${loginTimeoutSeconds}`, '-t', `${queryTimeoutSeconds}`, '-W', '-h', '-1'],
    ...['-i', queryFile, '-v', `MaxCount=${options.maxCount * candidatesPerPolicy}`]
  ];
}

/**
 * Reads the policy IDs from sqlcmd's output, upper-cased and without duplicates.
 * @throws When a non-blank line is not a policy ID, such as an error message sqlcmd printed.
 */
export function parseQueryOutput(output: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const unexpected = lines.find((line) => !isQuoteGuid(line));
  if (unexpected !== undefined) {
    throw new Error(`Unexpected sqlcmd output: ${unexpected}`);
  }

  return [...new Set(lines.map((line) => line.toUpperCase()))];
}

/** The list file: comment lines saying what it is and where it came from, then one policy ID per line. */
export function formatQuoteGuidList(
  options: Pick<NewGuidListOptions, 'environment' | 'server' | 'database' | 'now'>,
  policyDetailsIds: string[]
): string {
  const made = (options.now ?? new Date()).toISOString();
  const header = [
    `# Quote GUID list for ${options.environment}: TCAS policy details IDs of unpurchased NHI quotes the Policy API found.`,
    `# Made ${made} from ${options.server}/${options.database} by new-guid-list (sql/${queryFile}).`,
    `# environment: ${options.environment}`
  ];
  return `${[...header, ...policyDetailsIds].join('\n')}\n`;
}

async function runSqlcmdProcess(args: string[], cwd: string): Promise<string> {
  const child = spawn('sqlcmd', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (code !== 0) {
    throw new Error(`sqlcmd failed with exit code ${code}: ${output.trim()}`);
  }

  return output;
}
