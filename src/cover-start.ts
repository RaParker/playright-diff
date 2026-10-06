import type { Page } from 'playwright';
import { color } from './color.js';

const coverStartErrorPattern = /The cover start field needs to be between (\d{4}-\d{2}-\d{2})\b/i;
const coverDetailsHeadingPattern = /^\s*Cover details\s*$/;
const coverDetailsSectionSelector = 'div.av-timeline-all-sections > ul > li[title="Cover details"]';

/**
 * Fixes a cover start date the journey rejected ("The Cover start field needs to be between YYYY-MM-DD and ...").
 * Opens the Cover details section from the timeline unless it is already shown, then picks the earliest allowed
 * date in the Cover start calendar.
 * @param page Page showing the journey's error summary.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes the log line.
 * @param errors Error summary text to check.
 * @returns `true` when the cover start was changed, `false` when `errors` has no cover start error.
 * @throws When the date in the error is not a real date, or the section or calendar date cannot be clicked.
 */
export async function fixCoverStart(page: Page, label: string, errors: string | undefined): Promise<boolean> {
  const date = errors === undefined ? undefined : coverStartErrorPattern.exec(errors)?.[1];
  if (date === undefined) {
    return false;
  }

  console.log(color.Gray(`${label}: selecting cover start ${date} on Cover details.`));
  await showCoverDetails(page);
  await selectCoverStart(page, date);
  return true;
}

async function showCoverDetails(page: Page): Promise<void> {
  const heading = page.locator('h1').filter({ hasText: coverDetailsHeadingPattern });
  if (!(await heading.isVisible())) {
    await page.locator(coverDetailsSectionSelector).click();
    await heading.waitFor({ state: 'visible' });
  }
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
