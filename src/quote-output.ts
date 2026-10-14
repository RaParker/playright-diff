import { readFile, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { apiResponsesSuffix } from './api-responses.js';
import { color } from './color.js';
import { isMissing, readDirectoryNames } from './fs-helpers.js';
import { outputPath, policyFolderPattern } from './output-paths.js';

/** Files a quote-page run can write for each flow: the screenshot, and on failure or decline its HTML too. */
const outputSuffixes = ['.png', '-failed.png', '-failed.html', '-declined.png', '-declined.html'];

/**
 * Deletes the screenshots, failure HTML, API response folders and comparison reports a previous quote-page run wrote
 * for one policy, so a new run cannot leave stale results (for example an old `-failed.png` beside a new screenshot, or
 * an old response numbered among the new ones).
 * @param basename Output basename, `<policyDetailsId>-<historyId>`.
 * @param flows Flow names used in screenshot names (for example `nhi` and `tcas`).
 * @returns The number of screenshot/HTML files, API response folders and comparison reports removed.
 */
export async function removeQuoteOutput(
  basename: string,
  flows: string[]
): Promise<{ screenshots: number; apiResponses: number; comparisons: number }> {
  const screenshotPaths = flows.flatMap((flow) =>
    outputSuffixes.map((suffix) => outputPath('screenshots', `${basename}-${flow}${suffix}`))
  );
  const screenshots = (await Promise.all(screenshotPaths.map(removeFile))).filter(Boolean).length;
  const apiFolders = flows.map((flow) => outputPath('screenshots', `${basename}-${flow}${apiResponsesSuffix}`));
  const apiResponses = (await Promise.all(apiFolders.map(removeFolder))).filter(Boolean).length;
  const comparisons = await removeComparisons(basename, new Set(screenshotPaths));
  if (screenshots + apiResponses + comparisons > 0) {
    console.log(
      color.Gray(
        `Removed previous output for ${basename}: ${screenshots} screenshot(s), ${apiResponses} API response folder(s), ${comparisons} comparison(s).`
      )
    );
  }

  return { screenshots, apiResponses, comparisons };
}

/**
 * Removes the policy's own `comparisons/<basename>` report (even one a crashed run left without `report.json`) and
 * each other `comparisons/*` report whose `report.json` compares one of the given screenshots (such as older
 * `run-<timestamp>` reports). Other policies' folders only compare their own screenshots, so their reports are not
 * read, which keeps a run of many policies from reading every report once per policy.
 */
async function removeComparisons(basename: string, screenshotPaths: Set<string>): Promise<number> {
  const root = outputPath('comparisons');
  let removed = 0;
  for (const entry of await readDirectoryNames(root)) {
    const directory = join(root, entry);
    if (entry !== basename && policyFolderPattern.test(entry)) {
      continue;
    }

    const images = entry === basename ? [] : await readReportImages(join(directory, 'report.json'));
    if (entry === basename || images.some((image) => screenshotPaths.has(image))) {
      await rm(directory, { recursive: true, force: true });
      removed++;
    }
  }

  return removed;
}

/** @returns Whether the folder existed (it is removed with everything in it). */
async function removeFolder(path: string): Promise<boolean> {
  try {
    await stat(path);
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  await rm(path, { recursive: true, force: true });
  return true;
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
