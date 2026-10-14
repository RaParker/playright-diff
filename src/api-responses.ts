import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { Page, Response } from 'playwright';
import { isApiUrl } from './api-requests.js';
import { color } from './color.js';
import { isMissing } from './fs-helpers.js';

/** Suffix added to a screenshot's name (without its extension) for the folder of its capture's API responses. */
export const apiResponsesSuffix = '-api';

/** One saved API response, as written to its JSON file. */
export interface SavedApiResponse {
  url: string;
  method: string;
  status: number;
  /** Request body, parsed when it is JSON; `null` when the request had none. */
  requestBody: unknown;
  /** Response body, parsed when it is JSON, otherwise its text. */
  body: unknown;
}

/** API responses being saved while a page is open. */
export interface ApiResponseRecorder {
  /** Resolves once every response seen so far has been written (or failed to be, which only warns). */
  settled: () => Promise<void>;
}

/** Longest part of a response file name taken from the endpoint's path, so names stay within Windows path limits. */
const maxPathNameLength = 80;

/**
 * Gives the folder that holds the API responses of a screenshot's capture: the screenshot's path without its extension,
 * plus {@link apiResponsesSuffix} (for example `<ID>-1/nhi-api` for `<ID>-1/nhi.png`).
 * @param screenshotPath Path of the screenshot.
 * @returns The folder path.
 */
export function apiResponsesFolder(screenshotPath: string): string {
  return `${screenshotPath.slice(0, screenshotPath.length - extname(screenshotPath).length)}${apiResponsesSuffix}`;
}

/**
 * Starts saving every JSON response the page receives from the site's own API (`/api/` on the given origin), one file
 * per response, numbered in the order they arrive: `001-GET-quote-summary-<guid>.json`. Numbering carries on from the
 * files already in the folder, so a second capture into the same folder (such as NHI's Oops fallback) adds to the first.
 * Call {@link ApiResponseRecorder.settled} before closing the browser, since bodies can only be read while it is open.
 * @param page Page about to open the site.
 * @param origin Origin of the site, for example `https://quotes.example.com`.
 * @param folder Folder the files are written to; created with the first response, so a page that calls no API leaves
 * none.
 * @returns The recorder.
 * @throws When the folder exists but cannot be read.
 */
export async function recordApiResponses(page: Page, origin: string, folder: string): Promise<ApiResponseRecorder> {
  let sequence = await countFiles(folder);
  const writes: Promise<void>[] = [];
  page.on('response', (response) => {
    if (!isApiUrl(response.url(), origin) || !isJsonResponse(response)) {
      return;
    }

    sequence++;
    const path = join(folder, responseFileName(sequence, response));
    writes.push(
      saveResponse(response, path).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.log(color.Yellow(`Could not save API response ${response.url()}: ${reason}`));
      })
    );
  });
  return {
    settled: async () => {
      // Responses can arrive while earlier writes finish, so wait until no new write has started.
      let waited = 0;
      while (waited < writes.length) {
        waited = writes.length;
        await Promise.all(writes.slice(0, waited));
      }
    }
  };
}

/** @returns The number of entries in the folder, or 0 when it does not exist. */
async function countFiles(folder: string): Promise<number> {
  try {
    return (await readdir(folder)).length;
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }

    throw error;
  }
}

function isJsonResponse(response: Response): boolean {
  return /\bjson\b/i.test(response.headers()['content-type'] ?? '');
}

/** @returns For example `003-POST-nhi-quote-guid.json`: the sequence number, method and the path after `/api/`. */
function responseFileName(sequence: number, response: Response): string {
  const path = new URL(response.url()).pathname.slice('/api/'.length);
  const name = path
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxPathNameLength);
  return `${String(sequence).padStart(3, '0')}-${response.request().method()}-${name.length > 0 ? name : 'api'}.json`;
}

async function saveResponse(response: Response, path: string): Promise<void> {
  const request = response.request();
  const saved: SavedApiResponse = {
    url: response.url(),
    method: request.method(),
    status: response.status(),
    requestBody: parseBody(request.postData()),
    body: parseBody(await response.text())
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(saved, null, 2)}\n`);
}

/** @returns The text parsed as JSON, the text itself when it is not JSON, or `null` when there is none. */
function parseBody(text: string | null): unknown {
  if (text === null || text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
