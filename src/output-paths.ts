import { resolve } from 'node:path';

/** Folder holding the `screenshots` and `comparisons` folders, or `undefined` for the current working directory. */
let outputRoot: string | undefined;

/**
 * Sets the folder the `screenshots` and `comparisons` folders are kept in (`DIFF_OUTPUT_DIR`), so a run's output can
 * live outside the project. Paths passed on the command line (such as `--output`) are not affected.
 * @param root Output folder, resolved from the current working directory; `undefined` or blank uses the current
 * working directory.
 */
export function setOutputRoot(root: string | undefined): void {
  outputRoot = root === undefined || root.trim().length === 0 ? undefined : resolve(root);
}

/**
 * Resolves a path inside the output folder set by {@link setOutputRoot}.
 * @param segments Path segments, for example `'screenshots'` and a file name.
 * @returns The absolute path.
 */
export function outputPath(...segments: string[]): string {
  return resolve(outputRoot ?? '.', ...segments);
}
