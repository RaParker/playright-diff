import type { Page } from 'playwright';
import { color } from './color.js';

/** Quote page card listing the policy's endorsements, one `.hp-info-container` each, titled by `.hp-info-title`. */
const endorsementsCardClass = 'hp-endorsements-info';

/** HTML entities `outerHTML` writes in text, decoded when titles are read back from saved HTML. */
const htmlEntities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

/**
 * Standardises a quote page before its screenshot, so content that NHI and TCAS show in different orders cannot show
 * up as a difference. The endorsements are put in title order: NHI and TCAS list the same endorsements in different,
 * but stable, orders. Logs the order the page showed when it changes anything.
 * @param page Page showing the quote.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes the log.
 */
export async function standardiseQuotePage(page: Page, label: string): Promise<void> {
  // No named functions inside evaluate: tsx (used by the npm scripts) wraps them in __name(), which the browser lacks.
  const original = await page.evaluate((cardClass) => {
    const containers = [...document.querySelectorAll(`.${cardClass} > .hp-info-container`)];
    const titles = containers.map((container) => container.querySelector('.hp-info-title')?.textContent?.trim() ?? '');
    const order = containers.map((_container, index) => index);
    order.sort((a, b) => (titles[a] as string).localeCompare(titles[b] as string, 'en-GB'));
    if (order.some((position, index) => position !== index)) {
      // The containers sit together after the card's heading and introduction, so they go back in the same place.
      const anchor = containers[0]?.previousSibling ?? null;
      const parent = containers[0]?.parentElement;
      const sorted = order.map((position) => containers[position] as Element);
      if (anchor === null) {
        parent?.prepend(...sorted);
      } else {
        anchor.after(...sorted);
      }
    }

    return order.some((position, index) => position !== index) ? titles : undefined;
  }, endorsementsCardClass);
  if (original !== undefined) {
    console.log(color.Gray(`${label}: endorsements put in standard order; shown as: ${original.join(', ')}.`));
  }
}

/**
 * Reads the endorsement titles, in page order, from a quote page's saved HTML.
 * @param html The page's `outerHTML`, as saved beside its screenshot.
 * @returns The titles, or an empty list when the page lists no endorsements.
 */
export function readEndorsementTitles(html: string): string[] {
  const start = html.indexOf(endorsementsCardClass);
  if (start === -1) {
    return [];
  }

  // The card ends where the next card on the page starts.
  const end = html.indexOf('class="av-card ', start);
  const card = html.slice(start, end === -1 ? undefined : end);
  return [...card.matchAll(/<div class="hp-info-title">([^<]*)<\/div>/g)].map(([, title]) =>
    (title as string).replace(/&(?:amp|lt|gt|nbsp);/g, (entity) => htmlEntities[entity] as string).trim()
  );
}
