import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { screenshot, ValidationError } from '../dist/screenshot.js';
import { unsavedQuote } from '../dist/unsaved-quote.js';
import { assertGreyLogsAbsent, assertGreyLogsInOrder } from './log-assertions.mjs';
import { questionField, unsavedJourneyHtml } from './unsaved-journey-html.mjs';

const manySections = Array.from({ length: 45 }, (_value, index) => `Section ${index + 1}`);
const rebuildingCostSections = ['Cover details', 'Property circumstances', 'Contact details'];
const claimValueMessage = 'Must be between £1 and £10,000,000.';
const replacementDate = `1 January ${new Date().getFullYear() - 2}`;

/**
 * Builds a journey whose `section` (the second of three) shows `questions` with validation errors.
 * @param {string} section Section heading.
 * @param {{ id: string, message: string, field: string, expected: string }[]} questions Questions on `section`.
 * @returns {object} `unsavedJourneyHtml` options.
 */
function questionJourney(section, questions) {
  return {
    sections: ['Cover details', section, 'Contact details'],
    questions: questions.map((question) => ({ ...question, section }))
  };
}

for (const [name, journey, expectedError, expectedLogs = [], absentLogs = []] of [
  ['continues through each section and gets the quote', {}, undefined],
  [
    'reports the section and error summary when Continue fails validation',
    { errorOn: 'Property type' },
    /NHI journey validation failed on Property type: Enter the year built/
  ],
  [
    'waits for the lookup and walks the journey again when Get your quote returns to a section',
    { bounceTo: 'Property type' },
    undefined
  ],
  [
    'reports the section and error summary that Continue leaves in place after a return',
    { bounceTo: 'Property type', resolves: false },
    /NHI journey validation failed on Property type: Enter the number of bedrooms/
  ],
  [
    'stops when Get your quote returns to a section a second time',
    { bounceTo: 'Property type', bounceTimes: 2 },
    /NHI journey returned to Property type after Get your quote 2 times: Enter the number of bedrooms/
  ],
  [
    'stops when Get your quote is not reached within the section limit',
    { sections: manySections },
    /did not reach Get your quote within 40 sections/
  ],
  [
    'fixes the cover start date when Continue on Cover details reports it out of range',
    { coverStartError: 'continue' },
    undefined
  ],
  [
    'reports a cover start error that Continue still shows after the date is fixed',
    { coverStartError: 'continue', coverStartFixable: false },
    /NHI journey validation failed on Cover details: The Cover start field needs to be between 2026-10-06/
  ],
  [
    'opens Cover details from the timeline when Get your quote reports the cover start out of range',
    { coverStartError: 'quote' },
    undefined,
    ['NHI: selecting cover start 2026-10-06 on Cover details.', 'NHI: opening Cover details from the timeline.']
  ],
  [
    'stops when Get your quote keeps reporting the cover start after the date is fixed',
    { coverStartError: 'quote', coverStartFixable: false },
    /NHI journey returned to Contact details after Get your quote 2 times: The Cover start field needs to be between/
  ],
  [
    'enters the replacement email address when Get your quote reports invalid characters',
    { emailError: true },
    undefined
  ],
  [
    'stops when Get your quote keeps reporting the email address after it is replaced',
    { emailError: true, emailFixable: false },
    /NHI journey returned to Contact details after Get your quote 2 times: The Email address field contains invalid/
  ],
  ['fixes both the cover start date and the email address', { coverStartError: 'quote', emailError: true }, undefined],
  [
    'enters the replacement rebuilding cost when Continue on Property circumstances reports it',
    { sections: rebuildingCostSections, rebuildingCostError: true },
    undefined
  ],
  [
    'selects Choose another amount before entering the replacement rebuilding cost',
    { sections: rebuildingCostSections, rebuildingCostError: true, rebuildingCostOther: false },
    undefined,
    ['NHI: entering rebuilding cost 249995 on Property circumstances.', 'NHI: selecting Choose another amount.']
  ],
  [
    'reports a rebuilding cost error that Continue still shows after the cost is replaced',
    { sections: rebuildingCostSections, rebuildingCostError: true, rebuildingCostFixable: false },
    /NHI journey validation failed on Property circumstances: Enter the cost of rebuilding the property/
  ],
  [
    'enters the claim value on every claim that Continue on Household details reports out of range',
    questionJourney('Household details', [
      { id: 'claim~G01', message: claimValueMessage, field: questionField.text('claimPaid', '0'), expected: '55782' },
      { id: 'claim~G02', message: claimValueMessage, field: questionField.text('claimPaid', '0'), expected: '55782' }
    ]),
    undefined,
    ['NHI: entering claim value 55782 on Household details.']
  ],
  [
    'selects the roof material from its dropdown when Continue on Property construction reports it',
    questionJourney('Property construction', [
      {
        id: 'roof',
        message: 'Please select what your roof is made of.',
        field: questionField.dropdown('roofMaterial', ['Tile', 'Slate', 'Concrete']),
        expected: 'Slate'
      }
    ]),
    undefined,
    ['NHI: selecting roof material Slate on Property construction.']
  ],
  [
    'selects the external walls image when Continue on Property construction reports them',
    questionJourney('Property construction', [
      {
        id: 'walls',
        message: 'Please select what your external walls are made of.',
        field: questionField.images(['Brick', 'Stone', 'Other']),
        expected: 'Brick'
      }
    ]),
    undefined,
    ['NHI: selecting external walls Brick on Property construction.']
  ],
  [
    'selects the number of bathrooms and bedrooms when Continue on Property type reports both',
    questionJourney('Property type', [
      {
        id: 'bedrooms',
        message: 'Please select the number of bedrooms.',
        field: questionField.buttons('bedrooms', ['1', '2', '3', '10 or more']),
        expected: '3'
      },
      {
        id: 'bathrooms',
        message: 'Please select the number of bathrooms.',
        field: questionField.buttons('bathrooms', ['0', '1', '10 or more']),
        expected: '1'
      }
    ]),
    undefined,
    ['NHI: selecting bedrooms 3 on Property type.', 'NHI: selecting bathrooms 1 on Property type.']
  ],
  [
    'reports a claim value error that Continue still shows after the value is entered',
    questionJourney('Household details', [
      { id: 'claim~G01', message: claimValueMessage, field: questionField.text('claimPaid', '0'), expected: '1' }
    ]),
    /NHI journey validation failed on Household details: Must be between £1 and £10,000,000\./,
    ['NHI: entering claim value 55782 on Household details.']
  ],
  [
    'selects 1 January two years ago from the date dropdowns when Continue reports a date missing',
    questionJourney('Property circumstances', [
      {
        id: 'flood~G01',
        message: 'Please select day, month and year.',
        field: questionField.date('flood~G01'),
        expected: replacementDate
      }
    ]),
    undefined,
    [`NHI: selecting date ${replacementDate} on Property circumstances.`]
  ],
  [
    'types the criminal conviction and chooses the matching suggestion when Continue reports it missing',
    questionJourney('Household details', [
      {
        id: 'conviction~G01',
        message: 'Enter the criminal conviction that they were convicted of',
        field: questionField.autocomplete('criminalConvictionType', ['Handling stolen goods', 'Theft', 'Theft, shop']),
        expected: 'Theft'
      }
    ]),
    undefined,
    ['NHI: selecting criminal conviction Theft on Household details.']
  ],
  [
    'answers the tree location, distance and damage when Continue on Property circumstances reports them',
    questionJourney('Property circumstances', [
      {
        id: 'treeLocation~G01',
        message: 'The Tree location field must contain a value',
        field: questionField.buttons('treeLocation', ['Your property', "A neighbour's property", 'Other']),
        expected: 'Your property'
      },
      {
        id: 'treeDistance~G01',
        message: 'The Tree distance field must contain a value',
        field: questionField.text('nearbyTreeDistance'),
        expected: '10'
      },
      {
        id: 'treeDamage~G01',
        message: 'The Damage caused by tree field must contain a value',
        field: questionField.buttons('nearbyTreesCausedDamage', ['Yes', 'No']),
        expected: 'No'
      }
    ]),
    undefined,
    [
      'NHI: selecting tree location Your property on Property circumstances.',
      'NHI: entering tree distance 10 on Property circumstances.',
      'NHI: selecting tree damage No on Property circumstances.'
    ]
  ],
  [
    'leaves an error message shared by a question it has no answer for',
    questionJourney('Property type', [
      {
        id: 'other',
        message: 'Please answer this question.',
        field: questionField.buttons('otherQuestion', ['Yes', 'No']),
        expected: 'Yes'
      }
    ]),
    /NHI journey validation failed on Property type: Please answer this question\./,
    [],
    ['NHI: selecting own or rent Own (Mortgage) on Property type.']
  ]
]) {
  test(`unsaved quote journey ${name}`, async (context) => {
    // arrange
    const log = context.mock.method(console, 'log');
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(unsavedJourneyHtml(journey));
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const directory = await mkdtemp(join(tmpdir(), 'unsaved-quote-'));
    try {
      // act
      const capture = screenshot(`http://127.0.0.1:${server.address().port}`, {
        output: join(directory, 'quote.png'),
        wait: 0,
        timeout: 2000,
        beforeCapture: unsavedQuote
      });

      // assert
      if (expectedError === undefined) {
        await capture;
        assert.deepEqual(await readdir(directory), ['quote.png']);
      } else {
        await assert.rejects(capture, (error) => {
          assert.match(error.message, expectedError);
          // Only the site rejecting the answers is a validation failure; the section limit is not.
          assert.equal(
            error instanceof ValidationError,
            /^NHI journey (validation failed on|returned to) /.test(error.message),
            error.message
          );
          return true;
        });
        assert.deepEqual((await readdir(directory)).sort(), ['quote-failed.html', 'quote-failed.png']);
      }
      assertGreyLogsInOrder(log, expectedLogs);
      assertGreyLogsAbsent(log, absentLogs);
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    }
  });
}
