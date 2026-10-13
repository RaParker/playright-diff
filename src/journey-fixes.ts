import { errors, type Locator, type Page } from 'playwright';
import { recordAnswerChange, type AnswerChange } from './answer-changes.js';
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
/**
 * Name of the rebuilding cost fix in the `applied` set of {@link fixJourneyError}. The site can drop the saved cost
 * when Get your quote returns to a section (while the field still shows it), so a flow may remove this name to let the
 * fix be made again.
 */
export const rebuildingCostFixName = 'rebuilding cost';

/** Cover start date field, beside the Cover details calendar. */
const coverStartInputSelector = 'input.hp-date-input-single';
/** Month and year heading of each month the cover start calendar shows (it can show two), e.g. "August 2026". */
const calendarMonthSelector = '.react-datepicker__current-month';
/** Most months the calendar is moved to reach the cover start date, so a calendar that never shows it cannot loop. */
const maxCalendarMonthMoves = 24;
/** Selected answer of a button or image question: a filled button, or a ticked image. */
const selectedChoiceSelector = 'button.btn-primary:not(.dropdown-toggle), label.hp-checked';

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
  /**
   * Changes the field, once {@link section} is shown; `label` prefixes any further log lines.
   * @returns Each answer changed, with the answer shown before it.
   */
  apply: (page: Page, match: RegExpExecArray, label: string) => Promise<FixedAnswer[]>;
  /**
   * Whether the page shows the field to fix, for errors whose summary text other questions share; the fix is skipped
   * (and can still be tried later) when it does not.
   */
  isShown?: (page: Page) => Promise<boolean>;
}

/** An answer a fix changed, before the error that led to it is added (see {@link AnswerChange}). */
type FixedAnswer = Omit<AnswerChange, 'error'>;

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
   * `autocomplete` types it into {@link field} and then clicks the suggestion showing it, `check` ticks the checkbox in
   * the {@link field} element whose label shows it (leaving it ticked if it already is), and `date` picks each part of
   * a `D Month YYYY` answer from the question's day, month and year dropdowns.
   */
  kind: 'fill' | 'click' | 'dropdown' | 'autocomplete' | 'check' | 'date';
  /**
   * Selector of the field, buttons, dropdown toggle, checkbox wrappers (or, for `date`, the day dropdown toggle), within
   * the question.
   */
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
    answer: '5'
  },
  {
    message: 'The distance must be within 7 metres of the property.',
    section: 'Property circumstances',
    question: 'tree distance',
    kind: 'fill',
    field: 'input[name="nearbyTreeDistance"]',
    answer: '5'
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
  },
  {
    message: 'Please select an criminal conviction from the list.',
    section: 'Household details',
    question: 'criminal conviction',
    kind: 'autocomplete',
    field: 'input[name="criminalConvictionType"]',
    answer: 'Theft'
  },
  {
    message: 'Please select yes or no.',
    section: 'Property circumstances',
    question: 'flooded in the last 10 years',
    kind: 'click',
    field: 'button[name="flood"]',
    answer: 'No'
  },
  {
    message: 'Please select an option.',
    section: 'Property circumstances',
    question: 'main entrance lock',
    kind: 'click',
    field: 'div.hp-float > label:has(img[alt="Multi-point lock"])',
    answer: 'Multi-point lock'
  },
  {
    message: 'Please select an option.',
    section: 'Property circumstances',
    question: 'patio doors lock',
    kind: 'click',
    field: 'button[name="patioLockType"]',
    answer: 'Multi-point lock'
  },
  {
    message: 'Please select an option.',
    section: 'Property circumstances',
    question: 'other exits lock',
    kind: 'click',
    field: 'button[name="otherExitsLockType"]',
    answer: 'No other exit'
  },
  // Before who lives at the property: this usage ticks "You" there, which can clear that error.
  {
    message: 'Please select an option.',
    section: 'Resident details',
    question: 'property usage',
    kind: 'dropdown',
    field: dropdownToggle('howIsThePropertyUsed'),
    answer: 'I live here permanently (inc. rented homes)'
  },
  {
    message: 'The Who lives at the property field must contain a value',
    section: 'Resident details',
    question: 'who lives at the property',
    kind: 'check',
    field: 'div.form-check',
    answer: 'You'
  },
  {
    message: 'Please tell us how many adults live at the property.',
    section: 'Resident details',
    question: 'adults',
    kind: 'click',
    field: 'button[name="adults"]',
    answer: '1'
  },
  {
    message: 'Please tell us how many children live at the property.',
    section: 'Resident details',
    question: 'children',
    kind: 'click',
    field: 'button[name="children"]',
    answer: '0'
  },
  {
    message: 'Please select an option.',
    section: 'Resident details',
    question: 'when occupied',
    kind: 'click',
    field: 'button[name="whenIsOccupied"]',
    answer: 'Day and night'
  },
  {
    message: 'Please select an option.',
    section: 'Resident details',
    question: 'consecutive days unoccupied',
    kind: 'click',
    field: 'button[name="consecutiveDaysUnoccupied"]',
    answer: '0-30'
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
    name: 'renovation end',
    pattern: /The renovationEnd field needs to be between (\d{4}-\d{2}-\d{2})\b/i,
    section: 'Property circumstances',
    describe: (match) => `selecting renovation end ${match[1]}`,
    apply: (page, match) => selectRenovationEnd(page, match[0], match[1] ?? '')
  },
  {
    name: 'email address',
    pattern: /The Email address field contains invalid characters/i,
    section: 'Contact details',
    describe: () => `entering email address ${replacementEmail}`,
    apply: (page) => enterEmail(page)
  },
  {
    name: rebuildingCostFixName,
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
 * - "The renovationEnd field needs to be between YYYY-MM-DD and ..." picks the earliest allowed date from the "When is
 *   the work due to be completed?" day, month and year dropdowns on Property circumstances.
 * - "The Email address field contains invalid characters" enters {@link replacementEmail} on Contact details.
 * - "Enter the cost of rebuilding the property" selects "Choose another amount" (unless already selected, or not
 *   offered because there is no BCIS estimate) and enters {@link replacementRebuildingCost} on Property circumstances.
 * - Each message in {@link questionAnswers} (e.g. "Must be between £1 and £10,000,000." on a claim value, or "Please
 *   select what your roof is made of.") gives its answer to every question showing that message. The fix is skipped
 *   when no question showing the message has its field, as other questions share messages such as "Please answer this
 *   question.".
 *
 * Each fix is logged in grey, then opens its section from the timeline unless it is already shown; opening a section
 * and selecting "Choose another amount" are logged too. Each answer changed is recorded (see
 * {@link recordAnswerChange}) with the answer shown before it, the answer given (dates and checkbox lists as the page
 * then shows them), and the error summary line that led to it.
 * @param page Page showing the journey's error summary.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes the log lines.
 * @param errors Error summary text to check.
 * @param applied Names of fixes already made in this flow; fixes made now are added, and fixes already in it are not
 * tried again, so an error that persists is reported rather than fixed in a loop.
 * @returns The section of the last fix made, or `undefined` when `errors` reports nothing left to fix.
 * @throws When the cover start or renovation end date in the error is not a real date, or a section or field cannot be
 * used.
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
    const error = errorLine(errors ?? '', match[0]);
    for (const answer of await fix.apply(page, match, label)) {
      recordAnswerChange(label, fix.section, { ...answer, error });
    }

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
    // A question can have more than one message (e.g. missing, then out of range), each fixed once.
    name: `${answer.question}: ${answer.message}`,
    pattern: new RegExp(escapeRegExp(answer.message)),
    section: answer.section,
    describe: () => `${answer.kind === 'fill' ? 'entering' : 'selecting'} ${answer.question} ${answer.answer}`,
    apply: (page) => answerQuestions(page, answer),
    isShown: async (page) => (await errorQuestions(page, answer).count()) > 0
  };
}

async function answerQuestions(page: Page, answer: QuestionAnswer): Promise<FixedAnswer[]> {
  // Ids are read first, as answering a question can clear its error and so drop it from the locator.
  const ids = await errorQuestions(page, answer).evaluateAll((elements) => elements.map((element) => element.id));
  const answered: FixedAnswer[] = [];
  for (const id of ids) {
    const question = page.locator(`[id="${id}"]`);
    const field = question.locator(answer.field);
    const before = await readAnswer(question, answer);
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
      case 'check':
        await field
          .filter({ has: page.locator('label', { hasText: exactText(answer.answer) }) })
          .locator('input[type="checkbox"]')
          .check();
        break;
      case 'date':
        await chooseDate(page, question, answer.answer);
        break;
    }

    // Ticking a box leaves any others ticked, and a date is recorded as its toggles show it, so both are read back
    // rather than taken as the answer given.
    const readBack = answer.kind === 'check' || answer.kind === 'date';
    const after = readBack ? ((await readAnswer(question, answer)) ?? answer.answer) : answer.answer;
    answered.push({ question: answer.question, before, after });
  }

  return answered;
}

async function chooseDate(page: Page, question: Locator, date: string): Promise<void> {
  const values = date.split(' ');
  for (const [index, part] of dateParts.entries()) {
    await question.locator(`button.dropdown-toggle[id$="~K${part}"]`).click();
    await chooseDropdownItem(page, values[index] ?? '');
  }
}

async function enterRebuildingCost(page: Page, label: string): Promise<FixedAnswer[]> {
  const costField = page.locator('input[name="rebuildingCost"]');
  const before = await readValue(costField);
  // When a BCIS estimate is offered, the cost field is only shown once "Choose another amount" is selected; without an
  // estimate, the cost field is shown on its own.
  const otherAmount = page.locator('label[id$="~Kother"]').filter({ hasText: 'Choose another amount' });
  if (
    (await otherAmount.count()) > 0 &&
    !(await otherAmount.evaluate((element) => element.classList.contains('active')))
  ) {
    console.log(color.Gray(`${label}: selecting Choose another amount.`));
    await otherAmount.click();
  }

  await costField.fill(replacementRebuildingCost);
  return [{ question: 'rebuilding cost', before, after: replacementRebuildingCost }];
}

async function selectCoverStart(page: Page, dateText: string): Promise<FixedAnswer[]> {
  const date = parseErrorDate(dateText, 'cover start');
  const before = await readValue(page.locator(coverStartInputSelector));
  const day = date.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
  const label = `${monthName(date)} ${day}${suffix}, ${date.getUTCFullYear()}`;
  await page.locator('svg.av-icon-calendar').click();
  const dayButton = page.locator(`div[aria-label$="${label}"]:not(.react-datepicker__day--outside-month)`);
  await showCalendarMonth(page, date, dayButton, label);
  await dayButton.click();
  await waitForCoverStartChange(page, before);
  const after = (await readValue(page.locator(coverStartInputSelector))) ?? dateText;
  return [{ question: 'cover start', before, after }];
}

/**
 * Moves the cover start calendar a month at a time until it shows `dayButton`. The calendar opens on the month of the
 * date already given, which can be months away from the earliest date the journey allows.
 * @param page Page with the calendar open.
 * @param date Date to show.
 * @param dayButton The date's day in the calendar.
 * @param label The date as the calendar names it, for the error.
 * @throws When the calendar shows no month heading, or does not show the date within {@link maxCalendarMonthMoves}
 * months.
 */
async function showCalendarMonth(page: Page, date: Date, dayButton: Locator, label: string): Promise<void> {
  const heading = page.locator(calendarMonthSelector).first();
  // The calendar renders after the icon is clicked; a day already shown needs no month heading.
  await heading.or(dayButton).first().waitFor({ state: 'visible' });
  for (let moves = 0; !(await dayButton.isVisible()); moves++) {
    const shown = (await heading.textContent())?.trim() ?? '';
    const shownMonth = new Date(`1 ${shown} UTC`);
    if (moves === maxCalendarMonthMoves || Number.isNaN(shownMonth.getTime())) {
      throw new Error(`The cover start calendar did not show ${label} (it shows "${shown}").`);
    }

    const target = date.getUTCFullYear() * 12 + date.getUTCMonth();
    const current = shownMonth.getUTCFullYear() * 12 + shownMonth.getUTCMonth();
    await page.locator(`button[aria-label="${target < current ? 'Previous' : 'Next'} Month"]`).click();
    await page.waitForFunction(
      ([selector, previous]) => document.querySelector(selector)?.textContent?.trim() !== previous,
      [calendarMonthSelector, shown] as const
    );
  }
}

/**
 * Waits for the cover start field to show the date picked (e.g. "06 Oct 2026") once the calendar updates it, so it is
 * not read too early. Does not wait when the page has no such field, and a field that never changes is read as it is,
 * since recording the change must not fail the journey.
 */
async function waitForCoverStartChange(page: Page, before: string | null): Promise<void> {
  if ((await page.locator(coverStartInputSelector).count()) === 0) {
    return;
  }

  try {
    await page.waitForFunction(
      ([selector, previous]) => (document.querySelector<HTMLInputElement>(selector)?.value ?? '').trim() !== previous,
      [coverStartInputSelector, before ?? ''] as const
    );
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) {
      throw error;
    }
  }
}

async function enterEmail(page: Page): Promise<FixedAnswer[]> {
  const emailField = page.locator('input[name="email"]');
  const before = await readValue(emailField);
  await emailField.fill(replacementEmail);
  return [{ question: 'email address', before, after: replacementEmail }];
}

async function selectRenovationEnd(page: Page, message: string, dateText: string): Promise<FixedAnswer[]> {
  const date = parseErrorDate(dateText, 'renovation end');
  // The id is read first, as answering the question can clear its error and so drop it from the locator.
  const id = await page
    .locator('div.av-input-error')
    .filter({ has: page.locator('div.av-error-message', { hasText: message }) })
    .first()
    .getAttribute('id');
  const question = page.locator(`[id="${id ?? ''}"]`);
  const before = await readDate(question);
  const dateAnswer = `${date.getUTCDate()} ${monthName(date)} ${date.getUTCFullYear()}`;
  await chooseDate(page, question, dateAnswer);
  return [{ question: 'renovation end', before, after: (await readDate(question)) ?? dateAnswer }];
}

/**
 * Reads the answer a question shows, in the way {@link QuestionAnswer.kind} gives it: a text or autocomplete field's
 * value, the selected button or ticked image, the dropdown toggle's text, the ticked checkboxes' labels (joined by
 * commas), or the day, month and year toggles' texts (joined by spaces). Elements are read without waiting, so a
 * missing one reads as no answer rather than timing out.
 * @returns The answer, or `null` when the question shows none.
 */
async function readAnswer(question: Locator, answer: QuestionAnswer): Promise<string | null> {
  if (answer.kind === 'date') {
    return readDate(question);
  }

  const selector = {
    fill: answer.field,
    autocomplete: answer.field,
    click: selectedChoiceSelector,
    dropdown: answer.field,
    check: `${answer.field}:has(input[type="checkbox"]:checked)`
  }[answer.kind];
  const texts = await question
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element instanceof HTMLInputElement ? element.value : (element.textContent ?? '')).trim()
      )
    );
  return blankToNull(answer.kind === 'check' ? texts.join(', ') : (texts[0] ?? ''));
}

async function readDate(question: Locator): Promise<string | null> {
  const parts = await question.locator('button.dropdown-toggle').allTextContents();
  return blankToNull(parts.map((part) => part.trim()).join(' '));
}

/** Reads the first matching field's value without waiting; `null` when there is none or it is blank. */
async function readValue(field: Locator): Promise<string | null> {
  const values = await field.evaluateAll((elements) =>
    elements.map((element) => (element instanceof HTMLInputElement ? element.value : ''))
  );
  return blankToNull(values[0] ?? '');
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

/** The error summary line that `matched` (text a fix's pattern matched) is part of. */
function errorLine(errors: string, matched: string): string {
  return errors.split('\n').find((line) => line.includes(matched)) ?? matched;
}

function blankToNull(text: string): string | null {
  return text.trim().length > 0 ? text.trim() : null;
}

function parseErrorDate(dateText: string, field: string): Date {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
    throw new Error(`Invalid ${field} date in error summary: ${dateText}`);
  }

  return date;
}

function monthName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
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
