import type { Page } from 'playwright';
import { color } from './color.js';

/**
 * What a page reported while a capture ran: browser console errors and warnings, uncaught page errors, failed requests
 * and HTTP error responses, one line each with the seconds since recording started. Kept so a failure or a long wait
 * can show what the site was doing, which the screenshot alone cannot (for example a script error behind a loading
 * screen that never clears).
 */
export interface PageConsole {
  /** Every line recorded so far, oldest first (at most {@link maxLines}). */
  lines: () => string[];
}

/** Console message types recorded; the site logs a lot at `info` and `log`, which would bury these. */
const recordedConsoleTypes = new Set(['error', 'warning', 'assert']);
/** Lines kept; the oldest are dropped beyond this, so a page that logs in a loop cannot use up memory. */
const maxLines = 1000;
/** Lines {@link printConsoleTail} prints. */
const tailLines = 10;
/** Characters of a line {@link printConsoleTail} prints; the saved file keeps the whole line. */
const tailLineLength = 300;
/** Lowest HTTP status recorded as an error response. */
const firstErrorStatus = 400;
/** Failure Chromium gives a request it cancelled itself, such as on navigation; routine, so not recorded. */
const abortedRequestError = 'net::ERR_ABORTED';

/**
 * Starts recording what the page reports (see {@link PageConsole}). Call before the page opens its URL.
 * @param page Page to record.
 * @returns The recording.
 */
export function recordPageConsole(page: Page): PageConsole {
  const started = performance.now();
  const lines: string[] = [];
  const add = (kind: string, text: string): void => {
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    lines.push(`${seconds.padStart(6)} s ${kind}: ${text.replace(/\s+/g, ' ').trim()}`);
    if (lines.length > maxLines) {
      lines.shift();
    }
  };

  page.on('console', (message) => {
    if (recordedConsoleTypes.has(message.type())) {
      add(`console.${message.type()}`, message.text());
    }
  });
  page.on('pageerror', (error) => add('page error', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown error';
    if (failure !== abortedRequestError) {
      add('request failed', `${request.method()} ${request.url()} (${failure})`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= firstErrorStatus) {
      add(`HTTP ${response.status()}`, `${response.request().method()} ${response.url()}`);
    }
  });
  return { lines: () => [...lines] };
}

/**
 * Formats a recording for saving beside a failure screenshot.
 * @param pageConsole The recording.
 * @returns Its lines, one per line, or a note that the page reported nothing.
 */
export function formatPageConsole(pageConsole: PageConsole): string {
  const lines = pageConsole.lines();
  return lines.length === 0
    ? 'The page reported no console errors or warnings, page errors or failed requests.\n'
    : `${lines.join('\n')}\n`;
}

/**
 * Prints the last {@link tailLines} lines of a recording in grey, each cut to {@link tailLineLength} characters, under
 * a heading that says why; prints nothing when the page reported nothing.
 * @param pageConsole The recording.
 * @param reason Why it is printed, such as `while the loading screen was shown`.
 */
export function printConsoleTail(pageConsole: PageConsole, reason: string): void {
  const lines = pageConsole.lines();
  if (lines.length === 0) {
    return;
  }

  const tail = lines.slice(-tailLines);
  const shown = tail.length === lines.length ? `${lines.length}` : `last ${tail.length} of ${lines.length}`;
  console.log(color.Gray(`Browser console ${reason} (${shown}):`));
  for (const line of tail) {
    console.log(color.Gray(line.length > tailLineLength ? `${line.slice(0, tailLineLength)}…` : line));
  }
}
