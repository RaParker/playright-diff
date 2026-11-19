import { readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse, resolve } from 'node:path';
import { color } from './color.js';
import { isMissing, retryWhileBusy } from './fs-helpers.js';
import { contains, projectRoot } from './output-paths.js';

/** What clear-output did with the output folder: `listed` is a dry run that would have deleted it. */
export type ClearOutputOutcome = 'deleted' | 'listed' | 'missing' | 'refused';

/** How clear-output runs. */
export interface ClearOutputOptions {
  /** List the folder that would be deleted, with its entry count, without deleting anything. */
  dryRun?: boolean;
}

/** Folders clear-output refuses to delete, or delete anything containing. */
export interface ClearOutputProtectedPaths {
  /** This project's folder (default: the folder this module is built into). */
  projectRoot?: string;
  /** The user's profile folder (default: `os.homedir()`). */
  userProfile?: string;
}

/**
 * Deletes the output folder (`DIFF_OUTPUT_DIR/<environment>`) and everything in it, after printing the folder and how
 * many entries it holds. Nothing is deleted when the setting is blank, the folder is missing, or the folder is a drive
 * root, the user profile, this project, or a folder containing either of the last two.
 * @param outputDir The output folder, resolved from the current working directory.
 * @param protectedPaths Folders to protect instead of the defaults; replaceable in tests.
 * @param options With `dryRun`, only lists the folder that would be deleted.
 * @returns What was done.
 */
export async function clearOutput(
  outputDir: string | undefined,
  protectedPaths: ClearOutputProtectedPaths = {},
  options: ClearOutputOptions = {}
): Promise<ClearOutputOutcome> {
  if (outputDir === undefined || outputDir.trim().length === 0) {
    console.log(color.Red('DIFF_OUTPUT_DIR is not set in .env or the environment; nothing was deleted.'));
    return 'refused';
  }

  const target = resolve(outputDir);
  const reason = protectedReason(target, protectedPaths);
  if (reason !== undefined) {
    console.log(color.Red(`Refusing to delete ${target}: ${reason}. Nothing was deleted.`));
    return 'refused';
  }

  let childCount: number;
  try {
    childCount = (await readdir(target)).length;
  } catch (error) {
    if (isMissing(error)) {
      console.log(color.Yellow(`Output folder ${target} does not exist; nothing to delete.`));
      return 'missing';
    }

    throw error;
  }

  const listing = `  ${target} (${childCount} ${childCount === 1 ? 'entry' : 'entries'})`;
  if (options.dryRun === true) {
    console.log('Would delete these folders:');
    console.log(listing);
    console.log(color.Cyan('Dry run: nothing was deleted.'));
    return 'listed';
  }

  console.log('Deleting these folders:');
  console.log(listing);
  await retryWhileBusy(() => rm(target, { recursive: true, force: true }));
  console.log(color.Green(`Deleted ${target}.`));
  return 'deleted';
}

/** Says why the folder must not be deleted, or `undefined` when it may be. */
function protectedReason(target: string, protectedPaths: ClearOutputProtectedPaths): string | undefined {
  if (parse(target).root.toLowerCase() === target.toLowerCase()) {
    return 'it is a drive root';
  }

  const userProfile = resolve(protectedPaths.userProfile ?? homedir());
  if (contains(target, userProfile)) {
    return `it is or contains the user profile (${userProfile})`;
  }

  const project = resolve(protectedPaths.projectRoot ?? projectRoot);
  if (contains(target, project)) {
    return `it is or contains this project (${project})`;
  }

  return undefined;
}
