import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseJson, readOptionalTextFile, replaceFile } from './fs-helpers.js';
import { environmentFolder } from './output-paths.js';

/** The environments a run can target; a run name may not be one of them, so its folder is never mistaken for theirs. */
export const environmentNames: readonly string[] = ['dev', 'stg', 'tst'];

/** File in a named run's folder recording the environment the run was made with. */
export const runInfoFileName = 'run.json';

/** Characters Windows does not allow in a file name; `/` is also the separator on Linux. */
const forbiddenCharacters = /[<>:"/\\|?*]/;

/** Code points below U+0020 are control characters, which Windows does not allow and which break listings on Linux. */
const firstPrintableCode = 0x20;

/** Device names Windows reserves, with or without an extension (such as `nul` or `com1.txt`), in any case. */
const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Longest file name, in UTF-8 bytes, on common Linux file systems (Windows allows 255 UTF-16 characters). */
const maxNameBytes = 255;

/**
 * Checks that a run name (`QUOTE_JOURNEY_RUN_NAME`) can be a folder name on both Windows and Linux, so a run's output
 * goes to `OUTPUT_DIR/<run name>` on either.
 * @param name The run name, kept as given.
 * @returns The name.
 * @throws When the name is empty, `.` or `..`; contains `< > : " / \ | ? *` or a control character; ends with a space
 * or a dot (which Windows drops); is a reserved Windows device name; is over 255 UTF-8 bytes; or is an environment name.
 */
export function validateRunName(name: string): string {
  const problem = runNameProblem(name);
  if (problem !== undefined) {
    throw new Error(`QUOTE_JOURNEY_RUN_NAME "${name}" ${problem}.`);
  }

  return name;
}

/**
 * Resolves the output folder of a run: `OUTPUT_DIR/<run name>` for a named run, otherwise `OUTPUT_DIR/<environment>`
 * (see {@link environmentFolder}).
 * @param base Base output folder (`OUTPUT_DIR`), resolved from the current working directory.
 * @param environment `QUOTE_JOURNEY_ENVIRONMENT`.
 * @param runName `QUOTE_JOURNEY_RUN_NAME`; `undefined` or blank for the environment's own folder.
 * @returns The absolute folder.
 * @throws When the run name or the environment is not valid.
 */
export function runFolder(base: string, environment: string | undefined, runName: string | undefined): string {
  return runName === undefined || runName.length === 0
    ? environmentFolder(base, environment)
    : resolve(base, validateRunName(runName));
}

/**
 * Checks a named run is not reused with another environment, and records its environment on first use. Replacement
 * quote GUIDs in its mapping only exist in the environment that made them, so mixing environments gives Oops pages.
 * @param folder The run's output folder.
 * @param environment `QUOTE_JOURNEY_ENVIRONMENT`; nothing is checked or recorded without one.
 * @param record Whether to record the environment when the folder has none yet (not for a dry run).
 * @throws When the run was made with another environment, or its run file cannot be read or written.
 */
export async function checkRunEnvironment(
  folder: string,
  environment: string | undefined,
  record: boolean
): Promise<void> {
  if (environment === undefined || environment.trim().length === 0) {
    return;
  }

  const current = environment.trim().toLowerCase();
  const path = resolve(folder, runInfoFileName);
  const content = await readOptionalTextFile(path);
  const recorded = content === undefined ? undefined : readRecordedEnvironment(parseJson(content, path));
  if (recorded !== undefined && recorded !== current) {
    throw new Error(
      `Run folder ${folder} was made with ${recorded}, not ${current}: its replacement quote GUIDs only exist in ` +
        `${recorded}. Use another run name, or run against ${recorded}.`
    );
  }

  if (recorded === undefined && record) {
    await mkdir(folder, { recursive: true });
    await replaceFile(path, `${JSON.stringify({ environment: current }, null, 2)}\n`);
  }
}

function runNameProblem(name: string): string | undefined {
  if (name.length === 0 || name === '.' || name === '..') {
    return 'is not a folder name';
  }

  if (forbiddenCharacters.test(name)) {
    return 'contains a character Windows or Linux does not allow in a folder name (< > : " / \\ | ? *)';
  }

  if ([...name].some((character) => (character.codePointAt(0) ?? 0) < firstPrintableCode)) {
    return 'contains a control character';
  }

  if (name.endsWith(' ') || name.endsWith('.')) {
    return 'ends with a space or a dot, which Windows drops from folder names';
  }

  if (reservedWindowsName.test(name)) {
    return 'is a name Windows reserves for a device (CON, PRN, AUX, NUL, COM1-9, LPT1-9)';
  }

  if (Buffer.byteLength(name, 'utf8') > maxNameBytes) {
    return `is longer than ${maxNameBytes} bytes`;
  }

  if (environmentNames.includes(name.toLowerCase())) {
    return "is an environment name; leave the run name out to use that environment's folder";
  }

  return undefined;
}

function readRecordedEnvironment(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || !('environment' in value)) {
    return undefined;
  }

  const { environment } = value as { environment: unknown };
  return typeof environment === 'string' ? environment : undefined;
}
