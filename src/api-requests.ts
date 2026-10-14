import type { Page, Request } from 'playwright';

/** API requests a page has made to its own origin, so a flow can wait for the work a click started to finish. */
export interface ApiRequests {
  /**
   * Resolves once no API request has been pending for {@link apiQuietMilliseconds}, or after
   * {@link apiSettleLimitMilliseconds} regardless.
   */
  settled: () => Promise<void>;
}

const apiQuietMilliseconds = 500;
const apiSettleLimitMilliseconds = 10000;

/**
 * Starts tracking the page's requests to `/api/` on the origin it shows now.
 * @param page Page opened on the journey.
 * @returns The tracked requests.
 */
export function trackApiRequests(page: Page): ApiRequests {
  const origin = new URL(page.url()).origin;
  const pending = new Set<Request>();
  page.on('request', (request) => {
    if (isApiUrl(request.url(), origin)) {
      pending.add(request);
    }
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => pending.delete(request));
  return {
    settled: async () => {
      // Proceed after the limit regardless, so a polling endpoint cannot stall the journey.
      const started = performance.now();
      let quietSince = performance.now();
      while (performance.now() - started < apiSettleLimitMilliseconds) {
        if (pending.size > 0) {
          quietSince = performance.now();
        } else if (performance.now() - quietSince >= apiQuietMilliseconds) {
          return;
        }

        await page.waitForTimeout(100);
      }
    }
  };
}

/**
 * Tells whether a URL is one of the site's own API endpoints: a path under `/api/` on the given origin.
 * @param url Request URL.
 * @param origin Origin of the page making the request, for example `https://quotes.example.com`.
 * @returns `true` for an API URL on that origin.
 */
export function isApiUrl(url: string, origin: string): boolean {
  const parsed = new URL(url);
  return parsed.origin === origin && parsed.pathname.startsWith('/api/');
}
