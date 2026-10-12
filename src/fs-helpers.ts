import { readdir, readFile } from 'node:fs/promises';

/**
 * Checks whether a file system error means the path does not exist.
 * @param error Error thrown by a `node:fs` call.
 * @returns `true` for an `ENOENT` error.
 */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
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
