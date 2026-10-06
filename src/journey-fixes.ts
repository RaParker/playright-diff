import type { Page } from 'playwright';
import { color } from './color.js';

/** Email address entered when the journey rejects the test data's email. */
export const replacementEmail = 'nobody.special@nhitest.com';

/** Rebuilding cost entered when the journey rejects the test data's rebuilding cost. */
export const replacementRebuildingCost = '249995';

interface JourneyFix {
  /** Key recorded in the `applied` set, so each fix is tried once. */
  name: string;
  /** Error summary text the fix recognises. */
  pattern: RegExp;
  /** Section heading (and timeline title) holding the field to fix. */
  section: string;
  /** Describes the change for the log line. */
  describe: (match: RegExpExecArray) => string;
  /** Changes the field, once {@link section} is shown; `label` prefixes any further log lines. */
  apply: (page: Page, match: RegExpExecArray, label: string) => Promise<void>;
}

/** Errors the journey can report about test data, and how each is fixed. */
const journeyFixes: JourneyFix[] = [
  {
    name: 'cover start',
    pattern: /The cover start field needs to be between (\d{4}-\d{2}-\d{2})\b/i,
    section: 'Cover details',
    describe: (match) => `selecting cover start ${match[1]}`,
    apply: (page, match) => selectCoverStart(page, match[1] ?? '')
  },
  {
    name: 'email address',
    pattern: /The Email address field contains invalid characters/i,
    section: 'Contact details',
    describe: () => `entering email address ${replacementEmail}`,
    apply: (page) => page.locator('input[name="email"]').fill(replacementEmail)
  },
  {
    name: 'rebuilding cost',
    pattern: /Enter the cost of rebuilding the property/i,
    section: 'Property circumstances',
    describe: () => `entering rebuilding cost ${replacementRebuildingCost}`,
    apply: (page, _match, label) => enterRebuildingCost(page, label)
  }
];

/**
 * Fixes test data the journey rejected, for each error in {@link journeyFixes} that `errors` reports and that has not
 * been fixed already:
 * - "The Cover start field needs to be between YYYY-MM-DD and ..." picks the earliest allowed date in the Cover start
 *   calendar on Cover details.
 * - "The Email address field contains invalid characters" enters {@link replacementEmail} on Contact details.
 * - "Enter the cost of rebuilding the property" selects "Choose another amount" (unless already selected) and enters
 *   {@link replacementRebuildingCost} on Property circumstances.
 *
 * Each fix is logged in grey, then opens its section from the timeline unless it is already shown; opening a section
 * and selecting "Choose another amount" are logged too.
 * @param page Page showing the journey's error summary.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes the log lines.
 * @param errors Error summary text to check.
 * @param applied Names of fixes already made in this flow; fixes made now are added, and fixes already in it are not
 * tried again, so an error that persists is reported rather than fixed in a loop.
 * @returns The section of the last fix made, or `undefined` when `errors` reports nothing left to fix.
 * @throws When the cover start date in the error is not a real date, or a section or field cannot be used.
 */
export async function fixJourneyError(
  page: Page,
  label: string,
  errors: string | undefined,
  applied: Set<string>
): Promise<string | undefined> {
  let fixedSection: string | undefined;
  for (const fix of journeyFixes) {
    const match = errors === undefined || applied.has(fix.name) ? null : fix.pattern.exec(errors);
    if (match === null) {
      continue;
    }

    console.log(color.Gray(`${label}: ${fix.describe(match)} on ${fix.section}.`));
    applied.add(fix.name);
    await showSection(page, fix.section, label);
    await fix.apply(page, match, label);
    fixedSection = fix.section;
  }

  return fixedSection;
}

async function showSection(page: Page, section: string, label: string): Promise<void> {
  const heading = page.locator('h1').filter({ hasText: new RegExp(`^\\s*${section}\\s*$`) });
  if (!(await heading.isVisible())) {
    console.log(color.Gray(`${label}: opening ${section} from the timeline.`));
    await page.locator(`div.av-timeline-all-sections > ul > li[title="${section}"]`).click();
    await heading.waitFor({ state: 'visible' });
  }
}

async function enterRebuildingCost(page: Page, label: string): Promise<void> {
  // The cost field is only shown once "Choose another amount" (rather than the BCIS estimate) is selected.
  const otherAmount = page.locator('label[id$="~Kother"]').filter({ hasText: 'Choose another amount' });
  if (!(await otherAmount.evaluate((element) => element.classList.contains('active')))) {
    console.log(color.Gray(`${label}: selecting Choose another amount.`));
    await otherAmount.click();
  }

  await page.locator('input[name="rebuildingCost"]').fill(replacementRebuildingCost);
}

async function selectCoverStart(page: Page, dateText: string): Promise<void> {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
    throw new Error(`Invalid cover start date in error summary: ${dateText}`);
  }

  const day = date.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const label = `${month} ${day}${suffix}, ${date.getUTCFullYear()}`;
  await page.locator('svg.av-icon-calendar').click();
  await page.locator(`div[aria-label$="${label}"]:not(.react-datepicker__day--outside-month)`).click();
}
