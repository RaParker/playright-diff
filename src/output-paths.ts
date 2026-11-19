import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This project's folder (the parent of `src/` or `dist/`), which output is never written into. */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Folder holding each policy's output folder, or `undefined` for the current working directory. */
let outputRoot: string | undefined;

/**
 * Sets the folder each policy's `<policyDetailsId>-<historyId>` output folder is kept in (`DIFF_OUTPUT_DIR`), so a
 * run's output can live outside the project. Paths passed on the command line (such as `--output`) are not affected.
 * @param root Output folder, resolved from the current working directory; `undefined` or blank uses the current
 * working directory.
 */
export function setOutputRoot(root: string | undefined): void {
  outputRoot = root === undefined || root.trim().length === 0 ? undefined : resolve(root);
}

/**
 * Resolves a path inside the output folder set by {@link setOutputRoot}.
 * @param segments Path segments, for example a policy folder name and a file name; none gives the output folder.
 * @param project This project's folder, which the output folder must be outside (replaceable in tests).
 * @returns The absolute path.
 * @throws When the output folder is this project or inside it (for example `DIFF_OUTPUT_DIR` is not set and the
 * command runs from the project root), so a run never changes anything in the project but `.env`.
 */
export function outputPath(...segments: string[]): string {
  return outputPathOutside(projectRoot, ...segments);
}

/** {@link outputPath} with the protected project folder given, for tests. */
export function outputPathOutside(project: string, ...segments: string[]): string {
  const root = resolve(outputRoot ?? '.');
  if (contains(project, root)) {
    throw new Error(
      `The output folder ${root} is inside this project (${project}). Set DIFF_OUTPUT_DIR in .env to a folder ` +
        'outside it, so runs leave the project unchanged.'
    );
  }

  return resolve(root, ...segments);
}

/** Whether `folder` is `path` or one of its parents, ignoring case as Windows does. */
export function contains(folder: string, path: string): boolean {
  // relative() gives an absolute path when the two are on different drives.
  const fromFolder = relative(folder.toLowerCase(), path.toLowerCase());
  return fromFolder !== '..' && !fromFolder.startsWith(`..${sep}`) && !isAbsolute(fromFolder);
}

/**
 * Resolves the folder for one environment inside a base folder, so results, the quote GUID mapping and MRP files from
 * dev, tst and stg are kept apart (for example `D:/temp/output` and `dev` give `D:/temp/output/dev`).
 * @param base Base folder (such as `DIFF_OUTPUT_DIR` or `MRP_AND_QUOTE_OUTPUT_DIR`), resolved from the current working
 * directory.
 * @param environment `QUOTE_JOURNEY_ENVIRONMENT`; `undefined` or blank gives the base folder itself.
 * @returns The absolute folder, with the environment in lower case.
 * @throws When the environment is not letters, digits and hyphens, so it can never leave the base folder.
 */
export function environmentFolder(base: string, environment: string | undefined): string {
  if (environment === undefined || environment.trim().length === 0) {
    return resolve(base);
  }

  const name = environment.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(
      `QUOTE_JOURNEY_ENVIRONMENT must be letters, digits and hyphens, such as dev (got "${environment}").`
    );
  }

  return resolve(base, name);
}

/** A quote-page output folder, `<policyDetailsId>-<historyId>`; others (such as `.ocr-cache`) are ignored. */
export const policyFolderPattern = /^[0-9a-f]{32}-\d+$/i;
