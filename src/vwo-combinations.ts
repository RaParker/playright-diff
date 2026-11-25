/**
 * A VWO (the site's A/B testing tool) campaign and the combination (variant) a capture is put in, so every capture sees
 * the same version of the site rather than one VWO picks at random for each new browser.
 */
export interface VwoCombination {
  /** The campaign's ID, as in VWO's `window._vwo_exp`. */
  campaign: number;
  /** The combination's number within the campaign (1 is usually the control). */
  combination: number;
}

/**
 * A cookie Playwright can add to a browser context before the page opens: for a domain and path, or (for a host with no
 * parent domain, such as an IP address) for the page's URL.
 */
export type VwoCookie = { name: string; value: string } & ({ domain: string; path: string } | { url: string });

const pairPattern = /^(\d+)\s*:\s*(\d+)$/;
/** Labels a host needs for its parent domain to be more than a top-level domain (`a.example.com` has three). */
const minimumLabelsForParentDomain = 3;

/**
 * Reads the `VWO_COMBINATIONS` setting: `campaign:combination` pairs separated by commas, such as `49:3,60:3`.
 * @param value The setting, or `undefined` when it is not set.
 * @returns The combinations, in the order given; none when the setting is unset or blank.
 * @throws When a pair is not two positive whole numbers, or a campaign is given twice.
 */
export function parseVwoCombinations(value: string | undefined): VwoCombination[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  const combinations: VwoCombination[] = [];
  for (const pair of value.split(',')) {
    const match = pairPattern.exec(pair.trim());
    const [campaign, combination] = match === null ? [0, 0] : [Number(match[1]), Number(match[2])];
    if (campaign < 1 || combination < 1) {
      throw new Error(
        `VWO_COMBINATIONS must be campaign:combination pairs separated by commas, such as 49:3,60:3, not "${value}".`
      );
    }

    if (combinations.some((existing) => existing.campaign === campaign)) {
      throw new Error(`VWO_COMBINATIONS gives campaign ${campaign} more than once: "${value}".`);
    }

    combinations.push({ campaign, combination });
  }

  return combinations;
}

/**
 * Builds the cookies that put a browser in the given VWO combinations: VWO reads `_vis_opt_exp_<campaign>_combi` before
 * choosing a combination itself. A cookie for a campaign that does not run on the page has no effect, so one list can
 * cover every environment.
 *
 * VWO keeps its cookies on the parent domain (`.homeprotect.co.uk` for `quotes-dev.homeprotect.co.uk`) and ignores one
 * set only for the page's host (seen on dev: no combination was chosen and the page never loaded), so the cookies go on
 * the parent domain. A host with no parent domain (an IP address, or two labels such as `example.com`) gets them for
 * its URL instead.
 * @param combinations The combinations (see {@link parseVwoCombinations}).
 * @param url The page the capture opens.
 * @returns One cookie per combination.
 */
export function vwoCookies(combinations: readonly VwoCombination[], url: string): VwoCookie[] {
  const scope = cookieScope(new URL(url));
  return combinations.map(({ campaign, combination }) => ({
    name: `_vis_opt_exp_${campaign}_combi`,
    value: String(combination),
    ...scope
  }));
}

/** Where {@link vwoCookies} sets its cookies: the host's parent domain, or the page's origin when it has none. */
function cookieScope(url: URL): { domain: string; path: string } | { url: string } {
  const labels = url.hostname.split('.');
  const isIpAddress = /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[');
  if (isIpAddress || labels.length < minimumLabelsForParentDomain) {
    return { url: url.origin };
  }

  return { domain: `.${labels.slice(1).join('.')}`, path: '/' };
}
