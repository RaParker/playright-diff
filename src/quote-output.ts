import { rm, stat } from 'node:fs/promises';
import { color } from './color.js';
import { isMissing } from './fs-helpers.js';
import { outputPath } from './output-paths.js';

/**
 * Deletes the output folder a previous quote-page run wrote for one policy (its screenshots, failure HTML, API
 * responses, comparison report, result and answer changes), so a new run cannot leave stale results (for example an
 * old `screenshot-failed-nhi.png` beside a new screenshot, or an old response numbered among the new ones).
 * @param basename Output folder name, `<policyDetailsId>-<historyId>`.
 * @returns Whether there was a folder to remove.
 */
export async function removeQuoteOutput(basename: string): Promise<boolean> {
  const folder = outputPath(basename);
  try {
    await stat(folder);
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  await rm(folder, { recursive: true, force: true });
  console.log(color.Gray(`Removed previous output for ${basename}.`));
  return true;
}
