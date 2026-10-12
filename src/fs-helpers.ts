import { readdir, readFile } from 'node:fs/promises';

/**
 * Checks whether a file system error means the path does not exist.
 * @param error Error thrown by a `node:fs` call.
 * @returns `true` for an `ENOENT` error.
 */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Error codes Windows reports while another process briefly holds a file open, such as a virus scanner. */
const busyErrorCodes = new Set(['EBUSY', 'EPERM', 'EACCES']);
/** Times {@link retryWhileBusy} tries an operation before giving up. */
const busyAttempts = 5;
/** Wait in milliseconds before the first retry, doubled for each one after (100, 200, 400 and 800 ms). */
const busyRetryDelay = 100;

/**
 * Runs a file system operation, retrying with a growing delay while it fails because the file is busy
 * (`EBUSY`, `EPERM` or `EACCES`, as Windows reports when another process holds it open).
 * @param operation Operation to run.
 * @param delay Waits the given milliseconds (default: a timer); replaceable in tests.
 * @returns The operation's result.
 * @throws The last error when the file is still busy after every attempt, or any other error at once.
 */
export async function retryWhileBusy<T>(
  operation: () => Promise<T>,
  delay: (milliseconds: number) => Promise<unknown> = wait
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= busyAttempts || !isBusy(error)) {
        throw error;
      }

      await delay(busyRetryDelay * 2 ** (attempt - 1));
    }
  }
}

/**
 * Reads a UTF-8 text file that may not exist.
 * @param path File path.
 * @returns The file's content, or `undefined` when it does not exist.
 * @throws When the file exists but cannot be read.
 */
export async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Lists the names of a folder's subfolders.
 * @param path Folder path.
 * @returns Subfolder names, sorted; none when the folder does not exist.
 * @throws When the folder exists but cannot be read.
 */
export async function readDirectoryNames(path: string): Promise<string[]> {
  return readEntryNames(path, (entry) => entry.isDirectory());
}

/**
 * Lists the names of a folder's files (not subfolders).
 * @param path Folder path.
 * @returns File names, sorted; none when the folder does not exist.
 * @throws When the folder exists but cannot be read.
 */
export async function readFileNames(path: string): Promise<string[]> {
  return readEntryNames(path, (entry) => entry.isFile());
}

async function readEntryNames(
  path: string,
  include: (entry: { isDirectory(): boolean; isFile(): boolean }) => boolean
): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(include)
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && busyErrorCodes.has(error.code);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
