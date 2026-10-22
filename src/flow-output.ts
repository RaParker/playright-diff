import { join } from 'node:path';
import type { CaptureStop, StoppedOutput } from './screenshot.js';

/** A flow quote-page captures, as its output files name it: NHI, or MRP (the TCAS journey). */
export type FlowName = 'nhi' | 'mrp';

/** Where quote-page saves one flow's capture in a policy's output folder. */
export interface FlowOutputPaths {
  /** The quote page's screenshot, `screenshot-quote-page-<flow>.png`. */
  screenshot: string;
  /** The quote page's HTML as the site rendered it, `quote-page-<flow>.html`. */
  html: string;
  /** The quote page's HTML as the screenshot shows it, `quote-page-standardized-<flow>.html`. */
  standardisedHtml: string;
  /**
   * What a capture that stops saves instead: `screenshot-declined-<flow>.png` and `declined-<flow>.html` for a decline,
   * `screenshot-failed-<flow>.png` and `failed-<flow>.html` for any other failure.
   */
  stopped: Record<CaptureStop, StoppedOutput>;
  /** Folder of the API responses the page received, `api-<flow>`. */
  apiResponses: string;
}

/** The files results saved before the current names (`nhi`/`tcas` first) hold, for the readers that fall back to them. */
export interface LegacyFlowOutputPaths {
  /** Folder of the API responses, `<flow>-api`. */
  apiResponses: string;
  /** HTML of a capture that failed, `<flow>-failed.html`. */
  failedHtml: string;
}

/** Each flow's name in results saved before the current names, where MRP was named after the TCAS journey. */
const legacyFlowNames: Readonly<Record<FlowName, string>> = { nhi: 'nhi', mrp: 'tcas' };

/**
 * Names the files quote-page saves for one flow (see {@link FlowOutputPaths}).
 * @param folder The policy's `<policyDetailsId>-<historyId>` output folder.
 * @param flow The flow.
 * @returns The paths, inside the folder.
 */
export function flowOutputPaths(folder: string, flow: FlowName): FlowOutputPaths {
  return {
    screenshot: join(folder, `screenshot-quote-page-${flow}.png`),
    html: join(folder, `quote-page-${flow}.html`),
    standardisedHtml: join(folder, `quote-page-standardized-${flow}.html`),
    stopped: {
      declined: {
        screenshot: join(folder, `screenshot-declined-${flow}.png`),
        html: join(folder, `declined-${flow}.html`)
      },
      failed: { screenshot: join(folder, `screenshot-failed-${flow}.png`), html: join(folder, `failed-${flow}.html`) }
    },
    apiResponses: join(folder, `api-${flow}`)
  };
}

/**
 * Names the files read back from one flow's capture in results saved before the current names (see
 * {@link LegacyFlowOutputPaths}), so they can still be summarised.
 * @param folder The policy's `<policyDetailsId>-<historyId>` output folder.
 * @param flow The flow.
 * @returns The paths, inside the folder.
 */
export function legacyFlowOutputPaths(folder: string, flow: FlowName): LegacyFlowOutputPaths {
  const name = legacyFlowNames[flow];
  return { apiResponses: join(folder, `${name}-api`), failedHtml: join(folder, `${name}-failed.html`) };
}
