import { color } from './color.js';

/**
 * Heading shown on the quote page (a quote, a conditional quote, or an estimated quote for a referral, which still
 * shows a price), for any customer name and apostrophe style.
 */
export const quoteHeadingPattern =
  "^Welcome\\s+.*?,\\s*here['’‘ʼ]s\\s+your\\s+(?:(?:conditional|estimated)\\s+)?quote\\s*$";

/**
 * Where a flow's journey ended. Every end point is compared: a quote, an estimated quote for a referral, a conditional
 * quote, or a decline ("We're sorry… unable to offer you a quote").
 */
export type QuoteEndpoint = 'quote' | 'referred' | 'conditional' | 'declined';

/** Where each flow's journey ended. */
export interface QuoteEndpoints {
  nhi: QuoteEndpoint;
  tcas: QuoteEndpoint;
}

/**
 * How a comparison is counted: `identical` when both flows quoted and the screenshots match, `different` when the
 * screenshots differ or the flows ended differently, and otherwise the end point both reached, so a matching referral,
 * conditional quote or decline is not counted as identical.
 */
export type ComparisonKind = 'identical' | 'different' | Exclude<QuoteEndpoint, 'quote'>;

/** Every end point, for checking saved results. */
const quoteEndpoints: readonly QuoteEndpoint[] = ['quote', 'referred', 'conditional', 'declined'];

/** How each end point is named in logs and summaries, after "NHI" or "both". */
const endpointNames: Record<QuoteEndpoint, string> = {
  quote: 'quoted',
  referred: 'referred',
  conditional: 'conditional',
  declined: 'declined'
};

/** Matching end points other than a quote, in the order the summaries list their counts. */
const matchingKinds = ['referred', 'conditional', 'declined'] as const;

/** HTML entities the quote page's heading can hold, decoded before it is matched. */
const headingEntities: Record<string, string> = {
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&#39;': "'",
  '&#x27;': "'",
  '&apos;': "'",
  '&amp;': '&',
  '&nbsp;': ' '
};

/**
 * Tells which kind of quote a captured quote page shows from its welcome heading ("here's your estimated quote" for a
 * referral, "here's your conditional quote", or "here's your quote"), the heading the site builds from the quote's
 * `isReferred` and `isConditional` flags.
 * @param html The quote page's HTML.
 * @returns `'referred'`, `'conditional'`, or `'quote'` when the heading names neither or is not found.
 */
export function readQuoteEndpoint(html: string): Exclude<QuoteEndpoint, 'declined'> {
  const quoteHeading = new RegExp(quoteHeadingPattern, 'i');
  for (const [, inner] of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = decodeHeading(inner ?? '');
    if (quoteHeading.test(text)) {
      return /\bestimated\s+quote\s*$/i.test(text)
        ? 'referred'
        : /\bconditional\s+quote\s*$/i.test(text)
          ? 'conditional'
          : 'quote';
    }
  }

  return 'quote';
}

/**
 * Counts a comparison as identical, different, or matching on an end point other than a quote (see
 * {@link ComparisonKind}). A result saved before end points were recorded counts as two quotes.
 * @param changedPixels Pixels that differ between the two screenshots.
 * @param endpoints Where each flow ended, when recorded.
 * @returns How the comparison is counted.
 */
export function classifyComparison(changedPixels: number, endpoints?: QuoteEndpoints): ComparisonKind {
  const { nhi, tcas } = endpoints ?? { nhi: 'quote', tcas: 'quote' };
  if (changedPixels > 0 || nhi !== tcas) {
    return 'different';
  }

  return nhi === 'quote' ? 'identical' : nhi;
}

/**
 * Describes where the flows ended, when either did not quote, for example `NHI referred, TCAS quoted`.
 * @param endpoints Where each flow ended, when recorded.
 * @returns The description, or `undefined` when both quoted or the end points were not recorded.
 */
export function describeEndpoints(endpoints?: QuoteEndpoints): string | undefined {
  if (endpoints === undefined || (endpoints.nhi === 'quote' && endpoints.tcas === 'quote')) {
    return undefined;
  }

  return endpoints.nhi === endpoints.tcas
    ? `NHI and TCAS both ${endpointNames[endpoints.nhi]}`
    : `NHI ${endpointNames[endpoints.nhi]}, TCAS ${endpointNames[endpoints.tcas]}`;
}

/**
 * Formats how a set of comparisons were counted, for the quote-pages and summarise totals, for example
 * `1 identical, 2 different, 1 both referred`. Identical is green and different yellow when any differ; a matching
 * referral, conditional quote or decline is yellow and listed only when there is one.
 * @param kinds How each comparison was counted.
 * @returns The counts, coloured.
 */
export function formatComparisonCounts(kinds: ComparisonKind[]): string {
  const count = (kind: ComparisonKind) => kinds.filter((each) => each === kind).length;
  const different = `${count('different')} different`;
  const matching = matchingKinds
    .filter((kind) => count(kind) > 0)
    .map((kind) => color.Yellow(`${count(kind)} both ${endpointNames[kind]}`));
  return [
    color.Green(`${count('identical')} identical`),
    count('different') > 0 ? color.Yellow(different) : different,
    ...matching
  ].join(', ');
}

/**
 * Checks a saved result's end points.
 * @param value The saved value.
 * @returns Whether it names a known end point for each flow.
 */
export function isQuoteEndpoints(value: unknown): value is QuoteEndpoints {
  return (
    value !== null &&
    typeof value === 'object' &&
    'nhi' in value &&
    quoteEndpoints.includes(value.nhi as QuoteEndpoint) &&
    'tcas' in value &&
    quoteEndpoints.includes(value.tcas as QuoteEndpoint)
  );
}

/** Reduces a heading's inner HTML to its text: tags removed, the entities it can hold decoded, spaces collapsed. */
function decodeHeading(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:rsquo|lsquo|#39|#x27|apos|amp|nbsp);/gi, (entity) => headingEntities[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}
