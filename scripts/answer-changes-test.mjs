import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { collectAnswerChanges, recordAnswerChange, writeAnswerChanges } from '../dist/answer-changes.js';
import { screenshot } from '../dist/screenshot.js';
import { tcasQuote } from '../dist/tcas-quote.js';
import { unsavedQuote } from '../dist/unsaved-quote.js';
import { questionField, unsavedJourneyHtml } from './unsaved-journey-html.mjs';

const claimValueMessage = 'Must be between £1 and £10,000,000.';

/**
 * Drives the unsaved journey built from `journey` to its quote page, collecting the answers changed on the way.
 * @param {object} journey `unsavedJourneyHtml` options.
 * @returns {Promise<object>} The answer changes, by flow and section.
 */
function journeyAnswerChanges(journey) {
  return pageAnswerChanges(unsavedJourneyHtml(journey), unsavedQuote);
}

/**
 * Serves `html` and runs `beforeCapture` on it up to the screenshot, collecting the answers changed on the way.
 * @param {string} html Page served.
 * @param {(page: object) => Promise<void>} beforeCapture Journey action, such as `unsavedQuote` or `tcasQuote`.
 * @returns {Promise<object>} The answer changes, by flow and section.
 */
async function pageAnswerChanges(html, beforeCapture) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'answer-changes-'));
  const changes = {};
  try {
    await collectAnswerChanges(changes, () =>
      screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 2000,
        beforeCapture
      })
    );
    return changes;
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
}

describe('answer changes', () => {
  test('records changes by lower-case flow and section, in order', async () => {
    // arrange
    const changes = {};

    // act
    await collectAnswerChanges(changes, async () => {
      recordAnswerChange('NHI', 'Property type', { question: 'bedrooms', before: null, after: '3', error: 'e1' });
      recordAnswerChange('NHI', 'Property type', { question: 'bathrooms', before: '0', after: '1', error: 'e2' });
      recordAnswerChange('TCAS', 'Cover details', { question: 'cover start', before: null, after: 'x', error: 'e3' });
    });

    // assert
    assert.deepEqual(changes, {
      nhi: {
        'Property type': [
          { question: 'bedrooms', before: null, after: '3', error: 'e1' },
          { question: 'bathrooms', before: '0', after: '1', error: 'e2' }
        ]
      },
      tcas: { 'Cover details': [{ question: 'cover start', before: null, after: 'x', error: 'e3' }] }
    });
  });

  test('keeps the changes of tasks running at the same time apart', async () => {
    // arrange
    const first = {};
    const second = {};
    const record = async (question, wait) => {
      await delay(wait);
      recordAnswerChange('NHI', 'Section', { question, before: null, after: 'a', error: 'e' });
    };

    // act
    await Promise.all([
      collectAnswerChanges(first, () => record('first', 20)),
      collectAnswerChanges(second, () => record('second', 0))
    ]);

    // assert
    assert.deepEqual(
      first.nhi.Section.map(({ question }) => question),
      ['first']
    );
    assert.deepEqual(
      second.nhi.Section.map(({ question }) => question),
      ['second']
    );
  });

  test('ignores changes recorded outside a collecting task', () => {
    // arrange, act, assert
    assert.doesNotThrow(() =>
      recordAnswerChange('NHI', 'Section', { question: 'q', before: null, after: 'a', error: 'e' })
    );
  });

  test('writes the policy and its changes with nhi before tcas and the error last', async () => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'answer-changes-'));
    const path = join(directory, 'comparisons', 'ABC-1', 'answer-changes.json');
    const change = { question: 'bedrooms', before: null, after: '3', error: 'Please select the number of bedrooms.' };

    // act
    const written = await writeAnswerChanges(path, {
      policyDetailsId: 'ABC',
      historyId: 1,
      changes: { tcas: { 'Property type': [change] }, nhi: { 'Property type': [change] } }
    });

    // assert
    assert.equal(written, true);
    const report = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(report, {
      policyDetailsId: 'ABC',
      historyId: 1,
      changes: { nhi: { 'Property type': [change] }, tcas: { 'Property type': [change] } }
    });
    assert.deepEqual(Object.keys(report.changes), ['nhi', 'tcas']);
    assert.deepEqual(Object.keys(report.changes.nhi['Property type'][0]), ['question', 'before', 'after', 'error']);
  });

  test('writes nothing when no answer was changed', async () => {
    // arrange
    const directory = await mkdtemp(join(tmpdir(), 'answer-changes-'));

    // act
    const written = await writeAnswerChanges(join(directory, 'policy', 'answer-changes.json'), {
      policyDetailsId: 'ABC',
      historyId: 1,
      changes: {}
    });

    // assert
    assert.equal(written, false);
    assert.deepEqual(await readdir(directory), []);
  });
});

describe('answer changes made by the journey fixes', () => {
  test('records each claim value entered, with the value it replaced', async () => {
    // arrange
    const section = 'Household details';
    const claim = (id) => ({
      section,
      id,
      message: claimValueMessage,
      field: questionField.text('claimPaid', '0'),
      expected: '55782'
    });

    // act
    const changes = await journeyAnswerChanges({
      sections: ['Cover details', section, 'Contact details'],
      questions: [claim('claim~G01'), claim('claim~G02')]
    });

    // assert
    const change = { question: 'claim value', before: '0', after: '55782', error: claimValueMessage };
    assert.deepEqual(changes, { nhi: { [section]: [change, change] } });
  });

  test('records a dropdown, image and button chosen where none was selected, by section', async () => {
    // arrange
    const construction = 'Property construction';
    const propertyType = 'Property type';
    const questions = [
      {
        section: construction,
        id: 'roof',
        message: 'Please select what your roof is made of.',
        field: questionField.dropdown('roofMaterial', ['Tile', 'Slate']),
        expected: 'Slate'
      },
      {
        section: construction,
        id: 'walls',
        message: 'Please select what your external walls are made of.',
        field: questionField.images(['Brick', 'Stone']),
        expected: 'Brick'
      },
      {
        section: propertyType,
        id: 'bedrooms',
        message: 'Please select the number of bedrooms.',
        field: questionField.buttons('bedrooms', ['1', '3']),
        expected: '3'
      }
    ];

    // act
    const changes = await journeyAnswerChanges({
      sections: ['Cover details', construction, propertyType, 'Contact details'],
      questions
    });

    // assert
    assert.deepEqual(changes, {
      nhi: {
        [construction]: [
          {
            question: 'roof material',
            before: 'Please select',
            after: 'Slate',
            error: 'Please select what your roof is made of.'
          },
          {
            question: 'external walls',
            before: null,
            after: 'Brick',
            error: 'Please select what your external walls are made of.'
          }
        ],
        [propertyType]: [
          { question: 'bedrooms', before: null, after: '3', error: 'Please select the number of bedrooms.' }
        ]
      }
    });
  });

  test('records the ticked boxes before and after ticking You', async () => {
    // arrange
    const section = 'Resident details';
    const message = 'The Who lives at the property field must contain a value';

    // act
    const changes = await journeyAnswerChanges({
      sections: ['Cover details', section, 'Contact details'],
      questions: [
        {
          section,
          id: 'whoLives',
          message,
          field: questionField.checkboxes('whoLivesAtProperty', ['You', 'Lodgers'], ['Lodgers']),
          expected: 'You, Lodgers'
        }
      ]
    });

    // assert
    assert.deepEqual(changes, {
      nhi: {
        [section]: [{ question: 'who lives at the property', before: 'Lodgers', after: 'You, Lodgers', error: message }]
      }
    });
  });

  test('records renovation end and other dates from day, month and year dropdowns as the toggles show them', async () => {
    // arrange
    const section = 'Property circumstances';
    const renovationMessage = 'The renovationEnd field needs to be between 2026-10-13 and 2031-10-13';
    const floodMessage = 'Please select day, month and year.';
    const floodYear = String(new Date().getFullYear() - 2);

    // act
    const changes = await journeyAnswerChanges({
      sections: ['Cover details', section, 'Contact details'],
      questions: [
        {
          section,
          id: 'renovationEnd',
          message: renovationMessage,
          field: questionField.date('renovationEnd', ['2026', '2027']),
          expected: '13 October 2026'
        },
        {
          section,
          id: 'flood~G01',
          message: floodMessage,
          field: questionField.date('flood~G01'),
          expected: `1 January ${floodYear}`
        }
      ]
    });

    // assert
    assert.deepEqual(changes, {
      nhi: {
        [section]: [
          { question: 'renovation end', before: 'day month year', after: '13 October 2026', error: renovationMessage },
          { question: 'date', before: 'day month year', after: `1 January ${floodYear}`, error: floodMessage }
        ]
      }
    });
  });

  test('records a TCAS change with the error summary line alone, without the TCAS errors heading', async () => {
    // arrange
    const message = 'The Email address field contains invalid characters';
    const html = `<h1>Cover details</h1>
    <div class="av-timeline-all-sections"><ul><li title="Contact details">Contact details</li></ul></div>
    <input name="email" type="text" hidden value="first name.last@example.com"><button hidden>Get your quote</button>
    <script>
      const email = document.querySelector('input');
      document.querySelector('li').onclick = () => {
        document.querySelector('h1').textContent = 'Contact details';
        email.hidden = false;
        document.querySelector('button').hidden = false;
      };
      document.querySelector('button').onclick = () => {
        document.querySelector('.av-card-error-summary')?.remove();
        if (email.value === 'nobody.special@nhitest.com') {
          document.body.innerHTML = "<h2>Welcome Alex, here's your quote</h2>";
        } else {
          document.body.insertAdjacentHTML('beforeend', '<div class="av-card-error-summary"><ul><li><a>${message}</a></li></ul></div>');
        }
      };
    </script>`;

    // act
    const changes = await pageAnswerChanges(html, tcasQuote);

    // assert
    assert.deepEqual(changes, {
      tcas: {
        'Contact details': [
          {
            question: 'email address',
            before: 'first name.last@example.com',
            after: 'nobody.special@nhitest.com',
            error: message
          }
        ]
      }
    });
  });

  test('records the cover start and email address with their full error summary lines', async () => {
    // arrange, act
    const changes = await journeyAnswerChanges({ coverStartError: 'quote', emailError: true });

    // assert
    assert.deepEqual(changes, {
      nhi: {
        'Cover details': [
          {
            question: 'cover start',
            before: '27 Aug 2026',
            after: '06 Oct 2026',
            error: 'The Cover start field needs to be between 2026-10-06 and 2026-11-20'
          }
        ],
        'Contact details': [
          {
            question: 'email address',
            before: 'first name.last@example.com',
            after: 'nobody.special@nhitest.com',
            error: 'The Email address field contains invalid characters'
          }
        ]
      }
    });
  });
});
