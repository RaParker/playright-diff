export const quotePageHtml = '<h2>Welcome Alex, here&rsquo;s your quote</h2>';

/**
 * Builds the quote page's payment selector (markup trimmed from the live page).
 * @param {'monthly' | 'annually'} selected Option shown as selected.
 * @returns {string} Selector HTML.
 */
export function paymentSelectorHtml(selected) {
  const option = (period, heading) => `<div class="hp-btn-wrapper"><button
    id="Q405c8717-ea39-4864-9d77-c5fa904c57e2~K${period}" name="paymentSelector" type="button"
    class="btn ${period === selected ? 'btn-primary' : 'btn-outline-primary'}"><div class="hp-content">
    <div class="hp-heading">${heading}</div><div class="hp-select-box"><div
    class="${period === selected ? 'hp-selected-box' : 'hp-unselected-box'}"></div><span>Select</span></div>
    </div></button></div>`;
  return `<div class="hp-radio-button-list"><div class="btn-toolbar" role="group">${option('monthly', 'Pay monthly')}${option('annually', 'Pay annually')}</div></div>`;
}

/** Quote page with Pay monthly selected; nhiPagesHtml pages switch it to annual when Pay annually is clicked. */
export const monthlyQuotePageHtml = quotePageHtml + paymentSelectorHtml('monthly');

/** Declined quote page, as shown when the site cannot offer a quote. */
export const declinedPageHtml = `<h2>Welcome Mr. Alex, we&rsquo;re sorry...</h2><h3>We're sorry...</h3>
  <h4>But we're unable to offer you a quote based on your details</h4><button>Edit quote</button>`;

/** NHI quote summary page markup, without behaviour. */
export const summaryPageHtml = `<h1>Welcome Alex, thank you for choosing Homeprotect</h1>
  <div class="text-center"><button id="hp-summary-continue-button" type="button" class="hp-continue btn btn-primary"
    >Continue with quote</button></div>`;

/** NHI assumptions page markup, without behaviour. */
export const assumptionsPageHtml = `<h1>Assumptions</h1><div class="hp-button-group"><button id="hp-edit-questions-button"
  type="button" class="hp-previous-section btn btn-primary">No, I need to make changes</button><button
  id="hp-assumptions-quote-button" type="button" class="hp-continue btn btn-primary">Yes, take me to my quote</button></div>`;

/**
 * Builds NHI pages that move on when their buttons are clicked.
 * @param {string} start Markup shown first.
 * @param {Record<string, string>} routes Markup shown 100 ms after clicking the button with each id.
 * @returns {string} Page HTML.
 */
export function nhiPagesHtml(start, routes) {
  return `${start}<script>
    document.addEventListener('click', (event) => {
      if (event.target.closest('[id$="~Kannually"]') !== null) {
        document.querySelector('.hp-radio-button-list').outerHTML = ${JSON.stringify(paymentSelectorHtml('annually'))};
        return;
      }

      const next = ${JSON.stringify(routes)}[event.target.id];
      if (next !== undefined) setTimeout(() => { document.body.innerHTML = next; }, 100);
    });
  </script>`;
}

/** NHI quote summary page: Continue with quote shows the assumptions page, whose Yes button shows the quote. */
export const quoteSummaryHtml = nhiPagesHtml(summaryPageHtml, {
  'hp-summary-continue-button': assumptionsPageHtml,
  'hp-assumptions-quote-button': monthlyQuotePageHtml,
  'hp-edit-questions-button': '<h1>Cover details</h1>'
});

/**
 * Builds an `nhi=false` style journey: Continue moves through the sections, and Get your quote on the last
 * section shows the quote page.
 * @param {object} [options]
 * @param {string[]} [options.sections] Section headings in order.
 * @param {string} [options.errorOn] Section whose Continue always adds an error summary instead of moving on.
 * @param {string} [options.bounceTo] Section Get your quote returns to, showing an error summary and a
 * "Checking property details" lookup.
 * @param {number} [options.bounceTimes] How many Get your quote clicks return to bounceTo (default 1).
 * @param {number} [options.lookupMs] Milliseconds until the lookup finishes (default 300).
 * @param {boolean} [options.resolves] Whether Continue clears the summary once the lookup finishes (default true);
 * when false, Continue leaves the summary in place, like an answer that fails validation.
 * @param {boolean} [options.declines] Whether Get your quote shows the declined page instead of the quote.
 * @param {'continue' | 'quote'} [options.coverStartError] Adds a section timeline and a Cover start calendar (shown on
 * Cover details only), and reports the cover start date as out of range until October 6th is picked: on Continue from
 * Cover details, or when Get your quote is clicked (staying on the last section).
 * @param {boolean} [options.coverStartFixable] Whether picking October 6th clears the cover start error (default true).
 * @returns {string} Page HTML.
 */
export function unsavedJourneyHtml({
  sections = ['Cover details', 'Property type', 'Contact details'],
  errorOn,
  bounceTo,
  bounceTimes = 1,
  lookupMs = 300,
  resolves = true,
  declines = false,
  coverStartError,
  coverStartFixable = true
} = {}) {
  const coverStartHtml =
    coverStartError === undefined
      ? ''
      : `<div class="av-timeline-all-sections"><ul>${sections.map((section) => `<li title="${section}">${section}</li>`).join('')}</ul></div>
    <span id="calendar"><svg class="av-icon av-icon-calendar" width="24" height="24"><rect width="24" height="24" /></svg></span>
    <div id="day" hidden aria-label="Choose Tuesday, October 6th, 2026">6</div>`;
  return `<h1></h1>${coverStartHtml}<p id="lookup" hidden>Checking property details</p>
    <button id="continue">Continue</button><button id="quote" hidden>Get your quote</button><script>
    const sections = ${JSON.stringify(sections)};
    const errorOn = ${JSON.stringify(errorOn ?? null)};
    const bounceTo = ${JSON.stringify(bounceTo ?? null)};
    const lookupMs = ${JSON.stringify(lookupMs)};
    const resolves = ${JSON.stringify(resolves)};
    const coverStartError = ${JSON.stringify(coverStartError ?? null)};
    const coverStartFixable = ${JSON.stringify(coverStartFixable)};
    const coverStartSummary = 'The Cover start field needs to be between 2026-10-06 and 2026-11-20';
    let coverStartValid = coverStartError === null;
    let bouncesLeft = ${JSON.stringify(bounceTimes)};
    let lookupDone = true;
    let index = 0;
    const summary = (text) => '<div class="av-card-error-summary"><ul><li><a>' + text + '</a></li></ul></div>';
    const show = () => {
      const last = index === sections.length - 1;
      document.querySelector('h1').textContent = sections[index];
      document.getElementById('continue').hidden = last;
      document.getElementById('quote').hidden = !last;
      if (coverStartError !== null) document.getElementById('calendar').hidden = sections[index] !== 'Cover details';
    };
    show();
    if (coverStartError !== null) {
      document.querySelectorAll('li[title]').forEach((item) => {
        item.onclick = () => {
          index = sections.indexOf(item.title);
          show();
        };
      });
      document.querySelector('svg').onclick = () => { document.getElementById('day').hidden = false; };
      document.getElementById('day').onclick = () => { coverStartValid = coverStartFixable; };
    }
    document.getElementById('continue').onclick = () => {
      if (coverStartError === 'continue' && sections[index] === 'Cover details' && !coverStartValid) {
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary(coverStartSummary));
        return;
      }

      if (sections[index] === errorOn) {
        document.body.insertAdjacentHTML('beforeend', summary('Enter the year built'));
        return;
      }

      if (!lookupDone) {
        return;
      }

      document.querySelector('.av-card-error-summary')?.remove();
      index++;
      show();
    };
    document.getElementById('quote').onclick = () => {
      if (coverStartError === 'quote' && !coverStartValid) {
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary(coverStartSummary));
        return;
      }

      if (bounceTo !== null && bouncesLeft > 0) {
        bouncesLeft--;
        index = sections.indexOf(bounceTo);
        show();
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary('Enter the cost of rebuilding the property'));
        lookupDone = false;
        document.getElementById('lookup').hidden = false;
        setTimeout(() => {
          lookupDone = resolves;
          document.getElementById('lookup').hidden = true;
        }, lookupMs);
        return;
      }

      document.body.innerHTML = ${JSON.stringify(declines ? declinedPageHtml : quotePageHtml)};
    };
  </script>`;
}
