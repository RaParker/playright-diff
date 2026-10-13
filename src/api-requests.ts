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
  const isApi = (request: Request) => {
    const url = new URL(request.url());
    return url.origin === origin && url.pathname.startsWith('/api/');
  };

  page.on('request', (request) => {
    if (isApi(request)) {
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
