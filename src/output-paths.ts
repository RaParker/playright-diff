import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This project's folder (the parent of `src/` or `dist/`), which output is never written into. */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Folder in the output folder that the `-mrp.json` files are kept in, and mrp-and-quote's fetch saves into. */
export const mrpAndQuoteFolderName = 'mrp-and-quote';

/** Folder holding each policy's output folder, or `undefined` for the current working directory. */
let outputRoot: string | undefined;

/**
 * The environment's own folder (`OUTPUT_DIR/<environment>`), which holds its MRP files even when a named run keeps its
 * results elsewhere; `undefined` uses the output folder.
 */
let environmentRoot: string | undefined;

/**
 * Sets the folder each policy's `<policyDetailsId>-<historyId>` output folder is kept in (`OUTPUT_DIR`), so a
 * run's output can live outside the project. Paths passed on the command line (such as `--output`) are not affected.
 * @param root Output folder, resolved from the current working directory; `undefined` or blank uses the current
 * working directory.
 */
export function setOutputRoot(root: string | undefined): void {
  outputRoot = root === undefined || root.trim().length === 0 ? undefined : resolve(root);
}

/**
 * Sets the environment's own folder (`OUTPUT_DIR/<environment>`), where {@link mrpAndQuotePath} keeps the MRP files. It
 * differs from the output folder only for a named run (`QUOTE_JOURNEY_RUN_NAME`), whose results go to
 * `OUTPUT_DIR/<run name>` while it shares the environment's MRP files.
 * @param root The environment's folder; `undefined` or blank uses the output folder.
 */
export function setEnvironmentRoot(root: string | undefined): void {
  environmentRoot = root === undefined || root.trim().length === 0 ? undefined : resolve(root);
}

/**
 * @returns The folder of the environment's `-mrp.json` files (`OUTPUT_DIR/<environment>/mrp-and-quote`), which named
 * runs share with the environment's other runs, since the files are the environment's data.
 * @throws When the folder is this project or inside it.
 */
export function mrpAndQuotePath(): string {
  return environmentRoot === undefined
    ? outputPath(mrpAndQuoteFolderName)
    : assertOutsideProject(resolve(environmentRoot, mrpAndQuoteFolderName), 'OUTPUT_DIR');
}

/**
 * Resolves a path inside the output folder set by {@link setOutputRoot}.
 * @param segments Path segments, for example a policy folder name and a file name; none gives the output folder.
 * @param project This project's folder, which the output folder must be outside (replaceable in tests).
 * @returns The absolute path.
 * @throws When the output folder is this project or inside it (for example `OUTPUT_DIR` is not set and the
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
      `The output folder ${root} is inside this project (${project}). Set OUTPUT_DIR in .env to a folder ` +
        'outside it, so runs leave the project unchanged.'
    );
  }

  return resolve(root, ...segments);
}

/**
 * Checks that an output path given on the command line (such as `--output`) is outside this project, so a run never changes anything in the project but `.env`.
 * @param path The output file or folder, resolved from the current working directory.
 * @param description What the path is, for the error, such as `--output`.
 * @param project This project's folder (replaceable in tests).
 * @returns The absolute path.
 * @throws When the path is this project or inside it.
 */
export function assertOutsideProject(path: string, description: string, project: string = projectRoot): string {
  const resolved = resolve(path);
  if (contains(project, resolved)) {
    throw new Error(
      `The output path ${resolved} (${description}) is inside this project (${project}). Choose a folder outside it, ` +
        'so runs leave the project unchanged.'
    );
  }

  return resolved;
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
 * @param base Base folder (such as `OUTPUT_DIR`), resolved from the current working
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
