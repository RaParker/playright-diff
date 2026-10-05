import type { Page } from 'playwright';
import { color } from './color.js';

const annualButtonSelector = 'button[name="paymentSelector"][id$="~Kannually"]';
/** Box shown inside the payment option that is currently selected. */
const selectedBoxSelector = '.hp-selected-box';

/**
 * Makes sure the quote page shows annual rather than monthly payments, so NHI and TCAS screenshots compare the same
 * price. Clicks Pay annually unless it is already selected; a quote page with no payment selector is left as it is.
 * @param page Page showing the quote.
 * @param label Flow name (e.g. `NHI` or `TCAS`) that prefixes logs and errors.
 * @throws When Pay annually is clicked but does not become selected before the timeout.
 */
export async function selectAnnualPayment(page: Page, label: string): Promise<void> {
  const annual = page.locator(annualButtonSelector);
  // The selector renders with the quote heading, which the journey has already waited for.
  if ((await annual.count()) === 0) {
    console.log(color.Gray(`${label}: no payment selector on the quote page; leaving payments as shown.`));
    return;
  }

  const selected = annual.locator(selectedBoxSelector);
  if ((await selected.count()) > 0) {
    return;
  }

  console.log(color.Gray(`${label}: selecting Pay annually.`));
  await annual.click();
  try {
    await selected.waitFor({ state: 'attached' });
  } catch (error) {
    throw new Error(`${label}: Pay annually was clicked but did not become selected.`, { cause: error });
  }
}
