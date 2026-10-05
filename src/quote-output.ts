import { readdir, readFile, rm, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { color } from './color.js';

/** Files a quote-page run can write for each flow: the screenshot, and on failure or decline its HTML too. */
const outputSuffixes = ['.png', '-failed.png', '-failed.html', '-declined.png', '-declined.html'];

/**
 * Deletes the screenshots, failure HTML and comparison reports a previous quote-page run wrote for one policy, so a new run
 * cannot leave stale results (for example an old `-failed.png` beside a new screenshot).
 * @param basename Output basename, `<policyDetailsId>-<historyId>`.
 * @param flows Flow names used in screenshot names (for example `nhi` and `tcas`).
 * @returns The number of screenshot/HTML files and comparison reports removed.
 */
export async function removeQuoteOutput(
  basename: string,
  flows: string[]
): Promise<{ screenshots: number; comparisons: number }> {
  const screenshotPaths = flows.flatMap((flow) =>
    outputSuffixes.map((suffix) => resolve('screenshots', `${basename}-${flow}${suffix}`))
  );
  const screenshots = (await Promise.all(screenshotPaths.map(removeFile))).filter(Boolean).length;
  const comparisons = await removeComparisons(new Set(screenshotPaths));
  if (screenshots + comparisons > 0) {
    console.log(
      color.Gray(`Removed previous output for ${basename}: ${screenshots} screenshot(s), ${comparisons} comparison(s).`)
    );
  }

  return { screenshots, comparisons };
}

/** Removes each `comparisons/*` report whose `report.json` compares one of the given screenshots. */
async function removeComparisons(screenshotPaths: Set<string>): Promise<number> {
  const root = resolve('comparisons');
  let removed = 0;
  for (const entry of await readDirectories(root)) {
    const directory = join(root, entry);
    const images = await readReportImages(join(directory, 'report.json'));
    if (images.some((image) => screenshotPaths.has(image))) {
      await rm(directory, { recursive: true, force: true });
      removed++;
    }
  }

  return removed;
}

async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }
}

async function readDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

/** @returns The report's `before` and `after` paths, or none when it is missing or unreadable (so it is kept). */
async function readReportImages(path: string): Promise<string[]> {
  try {
    const report: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (report === null || typeof report !== 'object') {
      return [];
    }

    return ['before' in report ? report['before'] : undefined, 'after' in report ? report['after'] : undefined].filter(
      (image): image is string => typeof image === 'string'
    );
  } catch {
    return [];
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
