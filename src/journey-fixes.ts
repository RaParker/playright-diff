import type { Locator, Page } from 'playwright';
import { color } from './color.js';
import { ValidationError } from './screenshot.js';

/** Section timeline shown on every journey section. */
const journeyTimelineSelector = 'div.av-timeline-all-sections';
/** Yes, take me to my quote, shown on the assumptions page. */
const assumptionsButtonSelector = 'button#hp-assumptions-quote-button';

/** Email address entered when the journey rejects the test data's email. */
export const replacementEmail = 'nobody.special@nhitest.com';

/** Rebuilding cost entered when the journey rejects the test data's rebuilding cost. */
export const replacementRebuildingCost = '249995';

/** Open dropdown menu item, shown once a dropdown's toggle is clicked. */
const dropdownItemSelector = '.dropdown-menu.show button.dropdown-item';

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
  /**
   * Whether the page shows the field to fix, for errors whose summary text other questions share; the fix is skipped
   * (and can still be tried later) when it does not.
   */
  isShown?: (page: Page) => Promise<boolean>;
}

/** A question the journey reports as unanswered (or out of range), and the answer given to it. */
interface QuestionAnswer {
  /** Error message shown on the question (and in the error summary). */
  message: string;
  /** Section heading (and timeline title) holding the question. */
  section: string;
  /** Question named in the log line, e.g. `claim value`. */
  question: string;
  /**
   * How the answer is given: `fill` types it into {@link field}, `click` clicks the {@link field} element showing it
   * (a button or image), `dropdown` clicks {@link field} (a dropdown toggle) and then the menu item showing it,
   * `autocomplete` types it into {@link field} and then clicks the suggestion showing it, and `date` picks each part of
   * a `D Month YYYY` answer from the question's day, month and year dropdowns.
   */
  kind: 'fill' | 'click' | 'dropdown' | 'autocomplete' | 'date';
  /** Selector of the field, buttons, dropdown toggle (or, for `date`, the day dropdown toggle), within the question. */
  field: string;
  /** Answer given. */
  answer: string;
}

/** Parts of a date question, matching the `~K` suffix of each part's dropdown toggle id. */
const dateParts = ['day', 'month', 'year'];

/**
 * Date given to a date question: 1 January two years ago. The year dropdown offers this year and the 25 before it, so
 * the year is worked out from today rather than fixed.
 */
const replacementDate = `1 January ${new Date().getFullYear() - 2}`;

/** Questions answered when the journey reports them; every question showing the message (e.g. each claim) is answered. */
const questionAnswers: QuestionAnswer[] = [
  {
    message: 'Must be between £1 and £10,000,000.',
    section: 'Household details',
    question: 'claim value',
    kind: 'fill',
    field: 'input[name="claimPaid"]',
    answer: '55782'
  },
  {
    message: 'Please select a claim/loss from the list.',
    section: 'Household details',
    question: 'claim type',
    kind: 'dropdown',
    field: dropdownToggle('claimType'),
    answer: 'Escape of water - other cause'
  },
  {
    message: 'Please select what your roof is made of.',
    section: 'Property construction',
    question: 'roof material',
    kind: 'dropdown',
    field: dropdownToggle('roofMaterial'),
    answer: 'Slate'
  },
  {
    message: 'Please select what your external walls are made of.',
    section: 'Property construction',
    question: 'external walls',
    kind: 'click',
    field: 'div.hp-float > label',
    answer: 'Brick'
  },
  {
    message: 'Please tell us what type of house it is.',
    section: 'Property type',
    question: 'house type',
    kind: 'dropdown',
    field: dropdownToggle('houseType'),
    answer: 'Detached House'
  },
  {
    message: 'Please answer this question.',
    section: 'Property type',
    question: 'own or rent',
    kind: 'click',
    field: 'button[name="ownOrRent"]',
    answer: 'Own (Mortgage)'
  },
  {
    message: 'Please enter the year the property was built.',
    section: 'Property type',
    question: 'year built',
    kind: 'fill',
    field: 'input[name="yearBuilt"]',
    answer: '1990'
  },
  {
    message: 'Please select the number of bedrooms.',
    section: 'Property type',
    question: 'bedrooms',
    kind: 'click',
    field: 'button[name="bedrooms"]',
    answer: '3'
  },
  {
    message: 'Please select the number of bathrooms.',
    section: 'Property type',
    question: 'bathrooms',
    kind: 'click',
    field: 'button[name="bathrooms"]',
    answer: '1'
  },
  {
    message: 'Please enter how long you held this type of insurance for.',
    section: 'Property type',
    question: 'years insured',
    kind: 'click',
    field: 'button[name="insuranceTypeLength"]',
    answer: '5'
  },
  {
    message: 'Enter the total replacement value of your contents',
    section: 'Your contents',
    question: 'contents value',
    kind: 'fill',
    field: 'input[name="contentsCost"]',
    answer: '50000'
  },
  {
    message: 'The Safe rating field must contain a value',
    section: 'Your contents',
    question: 'safe rating',
    kind: 'click',
    field: 'button[name="safeRating"]',
    answer: 'UK: £1k /£10k'
  },
  {
    message: 'The Flood cause field must contain a value',
    section: 'Property circumstances',
    question: 'flood cause',
    kind: 'click',
    field: 'button[name="floodCause"]',
    answer: 'Flood'
  },
  {
    message: 'Please select day, month and year.',
    section: 'Property circumstances',
    question: 'date',
    kind: 'date',
    field: 'button.dropdown-toggle[id$="~Kday"]',
    answer: replacementDate
  },
  {
    message: 'The Tree location field must contain a value',
    section: 'Property circumstances',
    question: 'tree location',
    kind: 'click',
    field: 'button[name="treeLocation"]',
    answer: 'Your property'
  },
  {
    message: 'The Tree distance field must contain a value',
    section: 'Property circumstances',
    question: 'tree distance',
    kind: 'fill',
    field: 'input[name="nearbyTreeDistance"]',
    answer: '10'
  },
  {
    message: 'The Damage caused by tree field must contain a value',
    section: 'Property circumstances',
    question: 'tree damage',
    kind: 'click',
    field: 'button[name="nearbyTreesCausedDamage"]',
    answer: 'No'
  },
  {
    message: 'Enter the criminal conviction that they were convicted of',
    section: 'Household details',
    question: 'criminal conviction',
    kind: 'autocomplete',
    field: 'input[name="criminalConvictionType"]',
    answer: 'Theft'
  }
];

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
  },
  ...questionAnswers.map(answerFix)
];

/**
 * Fixes test data the journey rejected, for each error in {@link journeyFixes} that `errors` reports and that has not
 * been fixed already:
 * - "The Cover start field needs to be between YYYY-MM-DD and ..." picks the earliest allowed date in the Cover start
 *   calendar on Cover details.
 * - "The Email address field contains invalid characters" enters {@link replacementEmail} on Contact details.
 * - "Enter the cost of rebuilding the property" selects "Choose another amount" (unless already selected) and enters
 *   {@link replacementRebuildingCost} on Property circumstances.
 * - Each message in {@link questionAnswers} (e.g. "Must be between £1 and £10,000,000." on a claim value, or "Please
 *   select what your roof is made of.") gives its answer to every question showing that message. The fix is skipped
 *   when no question showing the message has its field, as other questions share messages such as "Please answer this
 *   question.".
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
    if (match === null || (fix.isShown !== undefined && !(await fix.isShown(page)))) {
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

/**
 * Builds the error for an error summary the flow cannot fix: a {@link ValidationError} (shown in yellow) when the page
 * is a journey section (its section timeline is shown) or the assumptions page, because the site rejected the answers
 * there; otherwise (for example on the quote summary page) a plain `Error` (shown in red).
 * @param page Page showing the error summary.
 * @param message Error message.
 * @param cause Error that led to this one, if any.
 * @returns The error to throw.
 */
export async function errorSummaryError(page: Page, message: string, cause?: unknown): Promise<Error> {
  const onValidationPage =
    (await page.locator(journeyTimelineSelector).first().isVisible()) ||
    (await page.locator(assumptionsButtonSelector).first().isVisible());
  return onValidationPage ? new ValidationError(message, { cause }) : new Error(message, { cause });
}

async function showSection(page: Page, section: string, label: string): Promise<void> {
  const heading = page.locator('h1').filter({ hasText: new RegExp(`^\\s*${section}\\s*$`) });
  if (!(await heading.isVisible())) {
    console.log(color.Gray(`${label}: opening ${section} from the timeline.`));
    await page.locator(`${journeyTimelineSelector} > ul > li[title="${section}"]`).click();
    await heading.waitFor({ state: 'visible' });
  }
}

function answerFix(answer: QuestionAnswer): JourneyFix {
  return {
    name: answer.question,
    pattern: new RegExp(escapeRegExp(answer.message)),
    section: answer.section,
    describe: () => `${answer.kind === 'fill' ? 'entering' : 'selecting'} ${answer.question} ${answer.answer}`,
    apply: (page) => answerQuestions(page, answer),
    isShown: async (page) => (await errorQuestions(page, answer).count()) > 0
  };
}

async function answerQuestions(page: Page, answer: QuestionAnswer): Promise<void> {
  // Ids are read first, as answering a question can clear its error and so drop it from the locator.
  const ids = await errorQuestions(page, answer).evaluateAll((elements) => elements.map((element) => element.id));
  for (const id of ids) {
    const question = page.locator(`[id="${id}"]`);
    const field = question.locator(answer.field);
    switch (answer.kind) {
      case 'fill':
        await field.fill(answer.answer);
        break;
      case 'click':
        await field.filter({ hasText: exactText(answer.answer) }).click();
        break;
      case 'dropdown':
        await field.click();
        await chooseDropdownItem(page, answer.answer);
        break;
      case 'autocomplete':
        await field.fill(answer.answer);
        await chooseDropdownItem(page, answer.answer);
        break;
      case 'date':
        await chooseDate(page, question, answer.answer);
        break;
    }
  }
}

async function chooseDate(page: Page, question: Locator, date: string): Promise<void> {
  const values = date.split(' ');
  for (const [index, part] of dateParts.entries()) {
    await question.locator(`button.dropdown-toggle[id$="~K${part}"]`).click();
    await chooseDropdownItem(page, values[index] ?? '');
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

/** Questions showing `answer`'s error message that have its field. */
function errorQuestions(page: Page, answer: QuestionAnswer): Locator {
  return page.locator(`div.av-input-error:has(${answer.field})`).filter({
    has: page.locator('div.av-error-message', { hasText: exactText(answer.message) })
  });
}

async function chooseDropdownItem(page: Page, text: string): Promise<void> {
  await page
    .locator(dropdownItemSelector)
    .filter({ hasText: exactText(text) })
    .click();
}

function dropdownToggle(name: string): string {
  return `div.dropdown[name="${name}"] > button.dropdown-toggle`;
}

function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
