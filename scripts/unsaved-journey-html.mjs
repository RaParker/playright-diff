export const quotePageHtml = '<h2>Welcome Alex, here&rsquo;s your quote</h2>';

/** NHI quote summary page: its Continue with quote button shows the quote page. */
export const quoteSummaryHtml = `<h1>Welcome Alex, thank you for choosing Homeprotect</h1>
  <div class="text-center"><button id="hp-summary-continue-button" type="button" class="hp-continue btn btn-primary"
    onclick="document.body.innerHTML = '${quotePageHtml}'">Continue with quote</button></div>`;

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
 * @returns {string} Page HTML.
 */
export function unsavedJourneyHtml({
  sections = ['Cover details', 'Property type', 'Contact details'],
  errorOn,
  bounceTo,
  bounceTimes = 1,
  lookupMs = 300,
  resolves = true
} = {}) {
  return `<h1></h1><p id="lookup" hidden>Checking property details</p>
    <button id="continue">Continue</button><button id="quote" hidden>Get your quote</button><script>
    const sections = ${JSON.stringify(sections)};
    const errorOn = ${JSON.stringify(errorOn ?? null)};
    const bounceTo = ${JSON.stringify(bounceTo ?? null)};
    const lookupMs = ${JSON.stringify(lookupMs)};
    const resolves = ${JSON.stringify(resolves)};
    let bouncesLeft = ${JSON.stringify(bounceTimes)};
    let lookupDone = true;
    let index = 0;
    const summary = (text) => '<div class="av-card-error-summary"><ul><li><a>' + text + '</a></li></ul></div>';
    const show = () => {
      const last = index === sections.length - 1;
      document.querySelector('h1').textContent = sections[index];
      document.getElementById('continue').hidden = last;
      document.getElementById('quote').hidden = !last;
    };
    show();
    document.getElementById('continue').onclick = () => {
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

      document.body.innerHTML = ${JSON.stringify(quotePageHtml)};
    };
  </script>`;
}
