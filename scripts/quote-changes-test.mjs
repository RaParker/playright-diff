import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { compareQuotes, readQuoteChanges } from '../dist/quote-changes.js';

/** A quote with every field the named checks read, as both sides return it when the quotes match. */
function quote(overrides = {}) {
  const base = {
    policyRefNo: '',
    quoteGuid: 'nhi-guid',
    startDate: '2026-10-21T00:00:00',
    quoteAmounts: {
      yearlyAmount: 231.33,
      monthlyAmount: 21.39,
      depositAmount: 21.39,
      monthlyPaymentAmount: 256.68,
      adminFee: 50,
      callCentreUserCode: 'agent'
    },
    buildingsInsurance: { buildingsIsAllowed: true, buildingsSumInsured: 1000000, propertyRebuildCost: null },
    contentsInsurance: {
      contentsIsAllowed: true,
      contentsSumInsured: 25000,
      isHighRiskHighValueItemsAllowed: true,
      isGeneralValuablesCoveredAllowed: true,
      highRiskHighValueItemsTotal: 0
    },
    compulsoryExcesses: [{ key: 'GeneralBuildingsXS', description: 'Buildings excess', amount: 249 }],
    importantInformation: {
      endorsements: [{ transactorCode: 'UNOCCLAU', title: 'Unoccupancy clause', text: '<p>Clause</p>' }]
    },
    quoteListedItems: [],
    isConditional: false,
    isReferred: false,
    isDeclined: false,
    requiresSpecificTermsCheck: false,
    typeOfCover: 'BC'
  };
  return merge(base, overrides);
}

/** Deep-merges plain objects; arrays and other values in `overrides` replace those in `base`. */
function merge(base, overrides) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
        ? merge(base[key], value)
        : value;
  }
  return result;
}

const pedalCycle = {
  instance: 1,
  category: 22,
  categoryTitleDescription: 'Pedal Cycle',
  description: 'my red bike',
  value: 2000,
  isAwayFromHomeCoverRequired: true,
  includeInQuote: true
};
const laptop = {
  instance: 2,
  category: 30,
  categoryTitleDescription: 'Portable Computer',
  description: 'work laptop',
  value: 1350,
  isAwayFromHomeCoverRequired: false,
  includeInQuote: true
};

describe('compareQuotes', () => {
  for (const [name, nhi, mrp, expected] of [
    ['reports nothing for matching quotes', {}, {}, []],
    [
      'ignores noise fields, and null against an empty string',
      {
        policyRefNo: '',
        quoteGuid: 'a',
        startDate: '2026-10-21T00:00:00',
        quoteAmounts: { callCentreUserCode: 'agent' }
      },
      {
        policyRefNo: 'WP1514391BU',
        quoteGuid: 'b',
        startDate: '2026-10-21T00:00:00Z',
        quoteAmounts: { callCentreUserCode: '' },
        typeOfCover: 'BC'
      },
      []
    ],
    [
      'names buildings cover offered on NHI only',
      {},
      { buildingsInsurance: { buildingsIsAllowed: false } },
      [{ summary: 'Buildings cover: offered on NHI, not on MRP' }]
    ],
    [
      'names contents cover offered on MRP only',
      { contentsInsurance: { contentsIsAllowed: false } },
      {},
      [{ summary: 'Contents cover: not offered on NHI, offered on MRP' }]
    ],
    [
      'reports the two personal possessions flags as one change when they move together',
      {},
      { contentsInsurance: { isHighRiskHighValueItemsAllowed: false, isGeneralValuablesCoveredAllowed: false } },
      [{ summary: 'Personal possessions and high-risk items: allowed on NHI, not on MRP' }]
    ],
    [
      'reports each personal possessions flag when only one differs',
      {},
      { contentsInsurance: { isHighRiskHighValueItemsAllowed: false } },
      [{ summary: 'High-risk items cover: allowed on NHI, not on MRP' }]
    ],
    [
      'gives both amounts, keeping a third decimal place',
      {},
      { buildingsInsurance: { buildingsSumInsured: 1000000.675 }, quoteAmounts: { yearlyAmount: 240.1 } },
      [
        { summary: 'Buildings sum insured differs', detail: '£1,000,000 on NHI, £1,000,000.675 on MRP' },
        { summary: 'Annual premium differs', detail: '£231.33 on NHI, £240.10 on MRP' }
      ]
    ],
    [
      'names an excess only one side has, and one whose amount differs',
      {
        compulsoryExcesses: [
          { key: 'GeneralBuildingsXS', description: 'Buildings excess', amount: 249 },
          { key: 'FloodXS', description: 'Flooding excess', amount: 2500 }
        ]
      },
      { compulsoryExcesses: [{ key: 'GeneralBuildingsXS', description: 'Buildings excess', amount: 500 }] },
      [
        { summary: 'Excess only on NHI: Flooding excess', detail: '£2,500' },
        { summary: 'Buildings excess differs', detail: '£249 on NHI, £500 on MRP' }
      ]
    ],
    [
      'compares endorsements by code, ignoring their order',
      {
        importantInformation: {
          endorsements: [
            { transactorCode: 'A', title: 'First', text: 'a' },
            { transactorCode: 'B', title: 'Second', text: 'b' }
          ]
        }
      },
      {
        importantInformation: {
          endorsements: [
            { transactorCode: 'B', title: 'Second', text: 'b' },
            { transactorCode: 'A', title: 'First', text: 'a' }
          ]
        }
      },
      []
    ],
    [
      'names endorsements only one side has, and wording that differs',
      {
        importantInformation: {
          endorsements: [
            { transactorCode: 'EXTPERIL', title: 'Amendments', text: 'x' },
            { transactorCode: 'UNOCCLAU', title: 'Unoccupancy clause', text: 'old' }
          ]
        }
      },
      {
        importantInformation: {
          endorsements: [
            { transactorCode: 'UNOCCOVR', title: 'Limitations', text: 'y' },
            { transactorCode: 'UNOCCLAU', title: 'Unoccupancy clause', text: 'new' }
          ]
        }
      },
      [
        { summary: 'Endorsement only on NHI: EXTPERIL (Amendments)' },
        { summary: 'Endorsement wording differs: UNOCCLAU (Unoccupancy clause)' },
        { summary: 'Endorsement only on MRP: UNOCCOVR (Limitations)' }
      ]
    ],
    [
      'matches listed items numbered differently, and names one included on NHI only by category and value',
      { quoteListedItems: [pedalCycle, laptop] },
      {
        quoteListedItems: [
          { ...laptop, instance: 1 },
          { ...pedalCycle, instance: 2, includeInQuote: false }
        ]
      },
      [{ summary: 'Listed item: included on NHI, not on MRP', detail: 'Pedal Cycle, £2,000' }]
    ],
    [
      'names a listed item only one side has',
      { quoteListedItems: [pedalCycle] },
      { quoteListedItems: [] },
      [{ summary: 'Listed item only on NHI', detail: 'Pedal Cycle, £2,000' }]
    ],
    [
      'names yes/no facts that differ',
      { isConditional: true },
      { requiresSpecificTermsCheck: true },
      [
        { summary: 'Conditional quote: yes on NHI, no on MRP' },
        { summary: 'Specific terms check: no on NHI, yes on MRP' }
      ]
    ],
    [
      'names any other shared field that differs, ignoring fields only one side has',
      { typeOfCover: 'BC', voucherCodeViewModel: { amount: 5 } },
      { typeOfCover: 'B', addOnsNew: { home: { basic: { isAvailable: true } } } },
      [{ summary: 'Other data differs: typeOfCover', detail: '"BC" on NHI, "B" on MRP' }]
    ]
  ]) {
    test(name, () => {
      // arrange
      const [a, b] = [quote(nhi), quote(mrp)];

      // act
      const changes = compareQuotes(a, b, { nhi: 'quote', tcas: 'quote' });

      // assert
      assert.deepEqual(changes, expected);
    });
  }

  test('never shows the description a customer typed for a listed item', () => {
    // arrange
    const [a, b] = [
      quote({ quoteListedItems: [pedalCycle] }),
      quote({ quoteListedItems: [{ ...pedalCycle, includeInQuote: false }] })
    ];

    // act
    const changes = compareQuotes(a, b, { nhi: 'quote', tcas: 'quote' });

    // assert
    assert.ok(!JSON.stringify(changes).includes('my red bike'), JSON.stringify(changes));
  });

  for (const [name, endpoints, expected] of [
    [
      'names different end points first',
      { nhi: 'quote', tcas: 'referred' },
      [{ summary: 'End point: NHI quoted, MRP referred' }]
    ],
    ['leaves out matching end points', { nhi: 'referred', tcas: 'referred' }, []]
  ]) {
    test(name, () => {
      // arrange
      const [a, b] = [quote(), quote()];

      // act
      const changes = compareQuotes(a, b, endpoints);

      // assert
      assert.deepEqual(changes, expected);
    });
  }
});

describe('readQuoteChanges', () => {
  /** Writes a policy folder with the given NHI and MRP responses, each a list of [file name, quoteResult]. */
  async function policyFolder(context, nhiFiles, mrpFiles) {
    const folder = await mkdtemp(join(tmpdir(), 'quote-changes-'));
    context.after(() => rm(folder, { recursive: true, force: true }));
    for (const [side, files] of [
      ['nhi-api', nhiFiles],
      ['tcas-api', mrpFiles]
    ]) {
      await mkdir(join(folder, side), { recursive: true });
      for (const [name, quoteResult] of files) {
        await writeFile(
          join(folder, side, name),
          JSON.stringify({ url: 'x', method: 'GET', status: 200, body: { success: true, quoteResult } })
        );
      }
    }
    return folder;
  }

  const endpoints = { nhi: 'quote', tcas: 'quote' };

  test("compares NHI's last quote summary with MRP's last save-details response", async (context) => {
    // arrange
    const folder = await policyFolder(
      context,
      [['001-GET-quote-summary-guid-user-agent.json', quote()]],
      [
        ['001-GET-quote-summary-guid-user-agent.json', quote()],
        ['006-POST-save-details.json', quote({ buildingsInsurance: { buildingsIsAllowed: true } })],
        ['009-POST-save-details.json', quote({ buildingsInsurance: { buildingsIsAllowed: false } })]
      ]
    );

    // act
    const result = await readQuoteChanges(folder, endpoints);

    // assert
    assert.deepEqual(result, {
      status: 'compared',
      changes: [{ summary: 'Buildings cover: offered on NHI, not on MRP' }]
    });
  });

  test("uses MRP's quote summary when it has no save-details response", async (context) => {
    // arrange
    const folder = await policyFolder(
      context,
      [['001-GET-quote-summary-guid-user-agent.json', quote()]],
      [['001-GET-quote-summary-guid-user-agent.json', quote({ quoteAmounts: { adminFee: 0 } })]]
    );

    // act
    const result = await readQuoteChanges(folder, endpoints);

    // assert
    assert.deepEqual(result, {
      status: 'compared',
      changes: [{ summary: 'Admin fee differs', detail: '£50 on NHI, £0 on MRP' }]
    });
  });

  for (const [name, nhiFiles, mrpFiles, recorded, reason] of [
    [
      'a result without end points',
      [['001-GET-quote-summary-g.json', quote()]],
      [['006-POST-save-details.json', quote()]],
      undefined,
      'captured before end points were recorded'
    ],
    [
      'a missing NHI quote summary',
      [['002-POST-answers.json', {}]],
      [['006-POST-save-details.json', quote()]],
      endpoints,
      'no NHI quote summary saved'
    ],
    [
      'a missing MRP response',
      [['001-GET-quote-summary-g.json', quote()]],
      [],
      endpoints,
      'no MRP quote response saved'
    ]
  ]) {
    test(`reports ${name} as not captured, without comparing`, async (context) => {
      // arrange
      const folder = await policyFolder(context, nhiFiles, mrpFiles);

      // act
      const result = await readQuoteChanges(folder, recorded);

      // assert
      assert.deepEqual(result, { status: 'not-captured', reason });
    });
  }
});
