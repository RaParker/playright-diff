export const quotePageHtml = '<h2>Welcome Alex, here&rsquo;s your quote</h2>';
/** Quote page heading shown for a conditional quote. */
export const conditionalQuotePageHtml = '<h2>Welcome Mrs. Alex, here&rsquo;s your conditional quote</h2>';

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
 * Builds the Property circumstances rebuilding cost question (markup trimmed from the live page): the cost field is
 * only shown once "Choose another amount" is selected. Needs {@link otherAmountScript} on the page.
 * @param {boolean} other Whether "Choose another amount" starts selected, rather than the BCIS estimate.
 * @returns {string} Question HTML.
 */
export function rebuildingCostHtml(other) {
  return `<div id="rebuilding"><label id="Qrebuild~K424000" class="btn btn-primary${other ? '' : ' active'}"
    >Use £424,000 estimate</label><label id="Qrebuild~Kother" class="btn btn-primary${other ? ' active' : ''}"
    >Choose another amount</label><input inputmode="decimal" name="rebuildingCost" type="text"
    ${other ? '' : 'hidden'} value="500,000"></div>`;
}

/** Script that selects "Choose another amount" and shows the cost field when its label is clicked. */
export const otherAmountScript = `document.addEventListener('click', (event) => {
  const other = event.target.closest('label[id$="~Kother"]');
  if (other === null) return;
  if (other.classList.toggle('active')) {
    document.querySelector('label[id$="~K424000"]').classList.remove('active');
  }
  document.querySelector('input[name="rebuildingCost"]').hidden = !other.classList.contains('active');
});`;

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
 * @param {boolean} [options.emailError] Adds a section timeline and an email field (shown on Contact details only),
 * and reports the email address as invalid when Get your quote is clicked until nobody.special@nhitest.com is entered.
 * @param {boolean} [options.emailFixable] Whether entering that email clears the email error (default true).
 * @param {boolean} [options.rebuildingCostError] Adds the rebuilding cost question (shown on Property circumstances
 * only), and reports the rebuilding cost as missing on Continue from Property circumstances until 249995 is entered.
 * @param {boolean} [options.rebuildingCostOther] Whether "Choose another amount" starts selected (default true).
 * @param {boolean} [options.rebuildingCostFixable] Whether entering 249995 clears the rebuilding cost error (default
 * true).
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
  coverStartFixable = true,
  emailError = false,
  emailFixable = true,
  rebuildingCostError = false,
  rebuildingCostFixable = true,
  rebuildingCostOther = true
} = {}) {
  const timelineHtml =
    coverStartError === undefined && !emailError
      ? ''
      : `<div class="av-timeline-all-sections"><ul>${sections.map((section) => `<li title="${section}">${section}</li>`).join('')}</ul></div>`;
  const coverStartHtml =
    coverStartError === undefined
      ? ''
      : `<span id="calendar"><svg class="av-icon av-icon-calendar" width="24" height="24"><rect width="24" height="24" /></svg></span>
    <div id="day" hidden aria-label="Choose Tuesday, October 6th, 2026">6</div>`;
  const emailHtml = emailError
    ? '<input id="email" inputmode="email" name="email" type="text" class="form-control" value="first name.last@example.com">'
    : '';
  const rebuildingHtml = rebuildingCostError ? rebuildingCostHtml(rebuildingCostOther) : '';
  return `<h1></h1>${timelineHtml}${coverStartHtml}${emailHtml}${rebuildingHtml}<p id="lookup" hidden>Checking property details</p>
    <button id="continue">Continue</button><button id="quote" hidden>Get your quote</button><script>
    const sections = ${JSON.stringify(sections)};
    const errorOn = ${JSON.stringify(errorOn ?? null)};
    const bounceTo = ${JSON.stringify(bounceTo ?? null)};
    const lookupMs = ${JSON.stringify(lookupMs)};
    const resolves = ${JSON.stringify(resolves)};
    const coverStartError = ${JSON.stringify(coverStartError ?? null)};
    const coverStartFixable = ${JSON.stringify(coverStartFixable)};
    const coverStartSummary = 'The Cover start field needs to be between 2026-10-06 and 2026-11-20';
    const emailError = ${JSON.stringify(emailError)};
    const emailFixable = ${JSON.stringify(emailFixable)};
    const emailValid = () => !emailError || (emailFixable && document.getElementById('email').value === 'nobody.special@nhitest.com');
    const rebuildingCostError = ${JSON.stringify(rebuildingCostError)};
    const rebuildingCostFixable = ${JSON.stringify(rebuildingCostFixable)};
    const rebuildingCost = () => document.querySelector('input[name="rebuildingCost"]');
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
      if (emailError) document.getElementById('email').hidden = sections[index] !== 'Contact details';
      if (rebuildingCostError) document.getElementById('rebuilding').hidden = sections[index] !== 'Property circumstances';
    };
    show();
    ${otherAmountScript}
    document.querySelectorAll('li[title]').forEach((item) => {
      item.onclick = () => {
        index = sections.indexOf(item.title);
        show();
      };
    });
    if (coverStartError !== null) {
      document.querySelector('svg').onclick = () => { document.getElementById('day').hidden = false; };
      document.getElementById('day').onclick = () => { coverStartValid = coverStartFixable; };
    }
    document.getElementById('continue').onclick = () => {
      if (coverStartError === 'continue' && sections[index] === 'Cover details' && !coverStartValid) {
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary(coverStartSummary));
        return;
      }

      if (
        rebuildingCostError &&
        sections[index] === 'Property circumstances' &&
        !(rebuildingCostFixable && !rebuildingCost().hidden && rebuildingCost().value === '249995')
      ) {
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary('Enter the cost of rebuilding the property'));
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

      if (!emailValid()) {
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary('The Email address field contains invalid characters'));
        return;
      }

      if (bounceTo !== null && bouncesLeft > 0) {
        bouncesLeft--;
        index = sections.indexOf(bounceTo);
        show();
        document.querySelector('.av-card-error-summary')?.remove();
        document.body.insertAdjacentHTML('beforeend', summary('Enter the number of bedrooms'));
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
