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
      [{ summary: 'Buildings cover: offered on NHI, not on MRP', field: 'buildingsIsAllowed' }]
    ],
    [
      'names contents cover offered on MRP only',
      { contentsInsurance: { contentsIsAllowed: false } },
      {},
      [{ summary: 'Contents cover: not offered on NHI, offered on MRP', field: 'contentsIsAllowed' }]
    ],
    [
      'reports the two personal possessions flags as one change when they move together',
      {},
      { contentsInsurance: { isHighRiskHighValueItemsAllowed: false, isGeneralValuablesCoveredAllowed: false } },
      [
        {
          summary: 'Personal possessions and high-risk items: allowed on NHI, not on MRP',
          field: 'isHighRiskHighValueItemsAllowed, isGeneralValuablesCoveredAllowed'
        }
      ]
    ],
    [
      'reports each personal possessions flag when only one differs',
      {},
      { contentsInsurance: { isHighRiskHighValueItemsAllowed: false } },
      [
        {
          summary: 'High-risk items cover: allowed on NHI, not on MRP',
          field: 'isHighRiskHighValueItemsAllowed'
        }
      ]
    ],
    [
      'gives both amounts, keeping a third decimal place',
      {},
      { buildingsInsurance: { buildingsSumInsured: 1000000.675 }, quoteAmounts: { yearlyAmount: 240.1 } },
      [
        {
          summary: 'Buildings sum insured differs',
          field: 'buildingsSumInsured',
          detail: '£1,000,000 on NHI, £1,000,000.675 on MRP'
        },
        { summary: 'Annual premium differs', field: 'yearlyAmount', detail: '£231.33 on NHI, £240.10 on MRP' }
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
      'leaves out a high-risk items total that differs by the listed items one side does not include',
      { quoteListedItems: [pedalCycle, laptop], contentsInsurance: { highRiskHighValueItemsTotal: 3350 } },
      {
        quoteListedItems: [
          { ...pedalCycle, includeInQuote: false },
          { ...laptop, includeInQuote: false }
        ],
        contentsInsurance: { highRiskHighValueItemsTotal: 0 }
      },
      [
        { summary: 'Listed item: included on NHI, not on MRP', detail: 'Pedal Cycle, £2,000' },
        { summary: 'Listed item: included on NHI, not on MRP', detail: 'Portable Computer, £1,350' }
      ]
    ],
    [
      'reports a high-risk items total that differs by more than the listed items explain',
      { quoteListedItems: [pedalCycle], contentsInsurance: { highRiskHighValueItemsTotal: 2500 } },
      {
        quoteListedItems: [{ ...pedalCycle, includeInQuote: false }],
        contentsInsurance: { highRiskHighValueItemsTotal: 0 }
      },
      [
        {
          summary: 'High-risk items total differs',
          field: 'highRiskHighValueItemsTotal',
          detail: '£2,500 on NHI, £0 on MRP'
        },
        { summary: 'Listed item: included on NHI, not on MRP', detail: 'Pedal Cycle, £2,000' }
      ]
    ],
    [
      'leaves out listed items and their total when personal possessions cover differs',
      { quoteListedItems: [pedalCycle], contentsInsurance: { highRiskHighValueItemsTotal: 2000 } },
      {
        quoteListedItems: [{ ...pedalCycle, includeInQuote: false }, laptop],
        contentsInsurance: {
          isHighRiskHighValueItemsAllowed: false,
          isGeneralValuablesCoveredAllowed: false,
          highRiskHighValueItemsTotal: 0
        }
      },
      [
        {
          summary: 'Personal possessions and high-risk items: allowed on NHI, not on MRP',
          field: 'isHighRiskHighValueItemsAllowed, isGeneralValuablesCoveredAllowed'
        }
      ]
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
        { summary: 'Conditional quote: yes on NHI, no on MRP', field: 'isConditional' },
        { summary: 'Specific terms check: no on NHI, yes on MRP', field: 'requiresSpecificTermsCheck' }
      ]
    ],
    [
      'names any other shared field that differs, ignoring fields only one side has',
      { typeOfCover: 'BC', voucherCodeViewModel: { amount: 5 } },
      { typeOfCover: 'B', addOnsNew: { home: { basic: { isAvailable: true } } } },
      [{ summary: 'Other data differs: typeOfCover', detail: '"BC" on NHI, "B" on MRP' }]
    ],
    [
      "ignores a joint policyholder's relationship NHI leaves at 0",
      { jointPolicyHolders: [{ relationship: 0 }] },
      { jointPolicyHolders: [{ relationship: 11 }] },
      []
    ],
    [
      "ignores every joint policyholder's relationship NHI leaves at 0",
      { jointPolicyHolders: [{ relationship: 0 }, { relationship: 0 }] },
      { jointPolicyHolders: [{ relationship: 5 }, { relationship: 5 }] },
      []
    ],
    [
      "names a joint policyholder's relationship that differs on both sides",
      { jointPolicyHolders: [{ relationship: 5 }] },
      { jointPolicyHolders: [{ relationship: 6 }] },
      [{ summary: 'Other data differs: jointPolicyHolders[].relationship', detail: '5 on NHI, 6 on MRP' }]
    ],
    [
      "names a joint policyholder's relationship MRP leaves at 0",
      { jointPolicyHolders: [{ relationship: 11 }] },
      { jointPolicyHolders: [{ relationship: 0 }] },
      [{ summary: 'Other data differs: jointPolicyHolders[].relationship', detail: '11 on NHI, 0 on MRP' }]
    ],
    [
      "names joint policyholders' relationships when MRP also has a 0",
      { jointPolicyHolders: [{ relationship: 0 }, { relationship: 0 }] },
      { jointPolicyHolders: [{ relationship: 0 }, { relationship: 5 }] },
      [{ summary: 'Other data differs: jointPolicyHolders[].relationship', detail: '0, 0 on NHI, 0, 5 on MRP' }]
    ],
    [
      "ignores an evidence pack's code NHI leaves unset",
      { importantInformation: { evidencePacks: [{ transactorCode: null }] } },
      { importantInformation: { evidencePacks: [{ transactorCode: 'EVIBEDS' }] } },
      []
    ],
    [
      "names an evidence pack's code that differs on both sides",
      { importantInformation: { evidencePacks: [{ transactorCode: 'EVIBEDS' }] } },
      { importantInformation: { evidencePacks: [{ transactorCode: 'EVISINS' }] } },
      [
        {
          summary: 'Other data differs: importantInformation.evidencePacks[].transactorCode',
          detail: '"EVIBEDS" on NHI, "EVISINS" on MRP'
        }
      ]
    ],
    [
      "names an evidence pack's code MRP leaves unset",
      { importantInformation: { evidencePacks: [{ transactorCode: 'EVIBEDS' }] } },
      { importantInformation: { evidencePacks: [{ transactorCode: null }] } },
      [
        {
          summary: 'Other data differs: importantInformation.evidencePacks[].transactorCode',
          detail: '"EVIBEDS" on NHI, null on MRP'
        }
      ]
    ],
    [
      "names evidence packs' codes when MRP also leaves one unset",
      { importantInformation: { evidencePacks: [{ transactorCode: null }, { transactorCode: null }] } },
      { importantInformation: { evidencePacks: [{ transactorCode: null }, { transactorCode: 'EVIBEDS' }] } },
      [
        {
          summary: 'Other data differs: importantInformation.evidencePacks[].transactorCode',
          detail: 'null, null on NHI, "EVIBEDS", null on MRP'
        }
      ]
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
  /**
   * Writes a policy folder with the given NHI and MRP responses, each a list of [file name, quoteResult], in the API
   * response folders named by `folders` (the current names by default).
   */
  async function policyFolder(context, nhiFiles, mrpFiles, folders = ['api-nhi', 'api-mrp']) {
    const folder = await mkdtemp(join(tmpdir(), 'quote-changes-'));
    context.after(() => rm(folder, { recursive: true, force: true }));
    for (const [side, files] of [
      [folders[0], nhiFiles],
      [folders[1], mrpFiles]
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

  test("compares each side's last quote response, the one its page showed", async (context) => {
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
      changes: [{ summary: 'Buildings cover: offered on NHI, not on MRP', field: 'buildingsIsAllowed' }]
    });
  });

  test("uses NHI's re-quote when its page priced the quote again after its quote summary", async (context) => {
    // arrange
    const nhiQuoteSummary = quote({ quoteAmounts: { yearlyAmount: 329.22 }, isConditional: true });
    const nhiRequote = quote({ quoteAmounts: { yearlyAmount: 301.09 } });
    const folder = await policyFolder(
      context,
      [
        ['001-GET-quote-summary-guid-user-agent.json', nhiQuoteSummary],
        ['006-POST-save-details.json', nhiRequote]
      ],
      [['008-POST-save-details.json', quote({ quoteAmounts: { yearlyAmount: 301.09 } })]]
    );

    // act
    const result = await readQuoteChanges(folder, endpoints);

    // assert
    assert.deepEqual(result, { status: 'compared', changes: [] });
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
      changes: [{ summary: 'Admin fee differs', field: 'adminFee', detail: '£50 on NHI, £0 on MRP' }]
    });
  });

  test('reads the API response folders results used before the current names', async (context) => {
    // arrange
    const folder = await policyFolder(
      context,
      [['001-GET-quote-summary-guid-user-agent.json', quote()]],
      [['006-POST-save-details.json', quote({ quoteAmounts: { adminFee: 0 } })]],
      ['nhi-api', 'tcas-api']
    );

    // act
    const result = await readQuoteChanges(folder, endpoints);

    // assert
    assert.deepEqual(result, {
      status: 'compared',
      changes: [{ summary: 'Admin fee differs', field: 'adminFee', detail: '£50 on NHI, £0 on MRP' }]
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
      'a missing NHI quote response',
      [['002-POST-answers.json', {}]],
      [['006-POST-save-details.json', quote()]],
      endpoints,
      'no NHI quote response saved'
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
