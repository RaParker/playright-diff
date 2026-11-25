import { rm, stat } from 'node:fs/promises';
import { color } from './color.js';
import type { FlowOutputPaths } from './flow-output.js';
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

/**
 * Deletes what one flow's capture saved (see {@link FlowOutputPaths}): its screenshot, HTML, stopped-capture files (console included) and
 * API responses, so a capture that replaces it leaves nothing of the first behind. Files that do not exist are skipped.
 * @param paths The flow's files.
 * @throws When a file or folder exists but cannot be removed.
 */
export async function removeFlowOutput(paths: FlowOutputPaths): Promise<void> {
  const stopped = Object.values(paths.stopped).flatMap(({ screenshot, html, console }) => [screenshot, html, console]);
  await Promise.all(
    [paths.screenshot, paths.html, paths.standardisedHtml, ...stopped, paths.apiResponses].map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
}
