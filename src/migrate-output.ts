import { mkdir, readdir, rename, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { color } from './color.js';
import { isMissing, parseJson, readOptionalTextFile, replaceFile, retryWhileBusy } from './fs-helpers.js';
import { outputPath, policyFolderPattern } from './output-paths.js';

/** Folder older versions saved quote-page screenshots, failure pages and API responses in. */
const oldScreenshotsFolder = 'screenshots';
/** Folder older versions saved each policy's comparison, result and answer changes in, and the OCR cache. */
const oldComparisonsFolder = 'comparisons';
const ocrCacheFolder = '.ocr-cache';

/**
 * A quote-page file or folder in the old screenshots folder: `<policyDetailsId>-<historyId>-<flow><suffix>`, which
 * becomes `<policyDetailsId>-<historyId>/<flow><suffix>`.
 */
const oldScreenshotPattern =
  /^([0-9a-f]{32}-\d+)-((?:nhi|tcas)(?:\.png|-failed\.png|-failed\.html|-declined\.png|-declined\.html|-api))$/i;

/** One file or folder to move. */
export interface OutputMove {
  from: string;
  to: string;
}

/** What {@link planOutputMigration} found in an output folder. */
export interface OutputMigrationPlan {
  root: string;
  /** Moves whose target does not exist yet. */
  moves: OutputMove[];
  /** Moves left out because their target already exists (nothing is overwritten). */
  conflicts: OutputMove[];
  /** Entries of the old folders that are not quote-page output, such as `run-<timestamp>` reports; left in place. */
  unrecognised: string[];
}

/** Where {@link migrateOutput} looks and whether it moves anything. */
export interface MigrateOutputOptions {
  /** Output folder to migrate (default: the output folder, see {@link outputPath}). */
  root?: string;
  /** Move the files; without it, only reports what would move. */
  apply?: boolean;
}

/**
 * Moves output from the old layout (`screenshots/` and `comparisons/<policyDetailsId>-<historyId>/`) into one
 * `<policyDetailsId>-<historyId>/` folder per policy, as quote-page now writes it, and prints what it did. Without
 * `apply` it only prints what would move. Nothing is overwritten: an entry whose target exists is left in place and
 * listed, as are entries that are not quote-page output.
 * @param options Output folder and whether to move the files.
 * @returns The plan that was printed (and applied, with `apply`).
 * @throws When a folder cannot be read, or a file cannot be moved or rewritten.
 */
export async function migrateOutput(options: MigrateOutputOptions = {}): Promise<OutputMigrationPlan> {
  const plan = await planOutputMigration(options.root ?? outputPath());
  if (options.apply === true) {
    await applyOutputMigration(plan);
  }

  printPlan(plan, options.apply === true);
  return plan;
}

/**
 * Lists the moves that bring an output folder from the old layout to one folder per policy, without changing it.
 * @param root Output folder.
 * @returns The moves, the conflicts (targets that already exist) and the entries that are not quote-page output.
 * @throws When a folder exists but cannot be read.
 */
export async function planOutputMigration(root: string): Promise<OutputMigrationPlan> {
  const resolvedRoot = resolve(root);
  const candidates: OutputMove[] = [];
  const unrecognised: string[] = [];
  const screenshots = join(resolvedRoot, oldScreenshotsFolder);
  for (const name of await readEntries(screenshots)) {
    const [, policy, file] = oldScreenshotPattern.exec(name) ?? [];
    if (policy === undefined || file === undefined) {
      unrecognised.push(join(screenshots, name));
    } else {
      candidates.push({ from: join(screenshots, name), to: join(resolvedRoot, policy, file) });
    }
  }

  const comparisons = join(resolvedRoot, oldComparisonsFolder);
  for (const name of await readEntries(comparisons)) {
    if (name === ocrCacheFolder) {
      candidates.push({ from: join(comparisons, name), to: join(resolvedRoot, name) });
    } else if (policyFolderPattern.test(name)) {
      for (const file of await readEntries(join(comparisons, name))) {
        candidates.push({ from: join(comparisons, name, file), to: join(resolvedRoot, name, file) });
      }
    } else {
      unrecognised.push(join(comparisons, name));
    }
  }

  const exists = await Promise.all(candidates.map(({ to }) => pathExists(to)));
  return {
    root: resolvedRoot,
    moves: candidates.filter((_move, index) => exists[index] === false),
    conflicts: candidates.filter((_move, index) => exists[index] === true),
    unrecognised
  };
}

/**
 * Makes the moves of a plan, points each moved comparison report at its policy's screenshots in their new place, then
 * removes the old folders that are left empty.
 * @param plan Plan from {@link planOutputMigration}.
 * @throws When a file cannot be moved or a report cannot be read or rewritten.
 */
export async function applyOutputMigration(plan: OutputMigrationPlan): Promise<void> {
  for (const { from, to } of plan.moves) {
    await mkdir(dirname(to), { recursive: true });
    await retryWhileBusy(() => rename(from, to));
  }

  const movedReports = plan.moves.filter(({ to }) => basename(to) === 'report.json').map(({ to }) => dirname(to));
  for (const folder of movedReports) {
    await rewriteReportPaths(folder);
  }

  const comparisons = join(plan.root, oldComparisonsFolder);
  for (const name of await readEntries(comparisons)) {
    await removeIfEmpty(join(comparisons, name));
  }

  await removeIfEmpty(comparisons);
  await removeIfEmpty(join(plan.root, oldScreenshotsFolder));
}

/**
 * Points a moved report's `before` and `after` screenshots at the policy folder it is now in (for example
 * `…/screenshots/<ID>-1-nhi.png` becomes `…/<ID>-1/nhi.png`), in both `report.json` and `report.md`. Paths that are not
 * the policy's own quote-page screenshots are kept.
 */
async function rewriteReportPaths(folder: string): Promise<void> {
  const jsonPath = join(folder, 'report.json');
  const content = await readOptionalTextFile(jsonPath);
  const report = content === undefined ? undefined : parseJson(content, jsonPath);
  if (report === null || typeof report !== 'object') {
    return;
  }

  const replacements = new Map<string, string>();
  for (const key of ['before', 'after'] as const) {
    const path = key in report ? (report as Record<string, unknown>)[key] : undefined;
    const moved = typeof path === 'string' ? newScreenshotPath(path, folder) : undefined;
    if (typeof path === 'string' && moved !== undefined) {
      (report as Record<string, unknown>)[key] = moved;
      replacements.set(path, moved);
    }
  }

  if (replacements.size === 0) {
    return;
  }

  await replaceFile(jsonPath, JSON.stringify(report, null, 2));
  const markdownPath = join(folder, 'report.md');
  const markdown = await readOptionalTextFile(markdownPath);
  if (markdown !== undefined) {
    let rewritten = markdown;
    for (const [from, to] of replacements) {
      rewritten = rewritten.replaceAll(from, to);
    }

    await replaceFile(markdownPath, rewritten);
  }
}

function printPlan(plan: OutputMigrationPlan, applied: boolean): void {
  const policies = new Set(
    plan.moves.map(({ to }) => basename(dirname(to))).filter((name) => policyFolderPattern.test(name))
  );
  console.log(color.Cyan(`Output migration (${plan.root})`));
  if (plan.moves.length + plan.conflicts.length + plan.unrecognised.length === 0) {
    console.log('Nothing to migrate: no screenshots or comparisons folder output found.');
    return;
  }

  const moved = applied ? 'Moved' : 'Would move';
  console.log(`${moved} ${plan.moves.length} files and folders into ${policies.size} policy folders.`);
  printPaths(
    'Left in place because the target already exists',
    plan.conflicts.map(({ from, to }) => `${from} -> ${to}`)
  );
  printPaths('Left in place because they are not quote-page output', plan.unrecognised);
  if (!applied && plan.moves.length > 0) {
    console.log(color.Gray('Dry run: nothing was moved. Run again with --apply to move them.'));
  }
}

/** @returns Names of the folder's entries, sorted; none when the folder does not exist or is a file. */
async function readEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if (isMissing(error) || (error instanceof Error && 'code' in error && error.code === 'ENOTDIR')) {
      return [];
    }

    throw error;
  }
}

/** Removes the path when it is a folder with nothing in it; anything else is left alone. */
async function removeIfEmpty(path: string): Promise<void> {
  let isFolder: boolean;
  try {
    isFolder = (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return;
    }

    throw error;
  }

  if (isFolder && (await readdir(path)).length === 0) {
    await rmdir(path);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }
}

/** @returns The screenshot's path in the policy folder, or `undefined` when it is not that policy's screenshot. */
function newScreenshotPath(path: string, folder: string): string | undefined {
  // Old reports were written on Windows, so split on either separator whatever the platform.
  const name = path.split(/[\\/]/).pop() ?? '';
  const [, policy, file] = oldScreenshotPattern.exec(name) ?? [];
  return policy?.toUpperCase() === basename(folder).toUpperCase() && file !== undefined
    ? join(folder, file)
    : undefined;
}

function printPaths(title: string, paths: string[]): void {
  if (paths.length === 0) {
    return;
  }

  console.log(color.Yellow(`${title} (${paths.length}):`));
  for (const path of paths) {
    console.log(`  ${path}`);
  }
}
