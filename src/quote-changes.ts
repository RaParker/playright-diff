import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { flowOutputPaths, legacyFlowOutputPaths, type FlowName } from './flow-output.js';
import { parseJson, readOptionalTextFile } from './fs-helpers.js';
import { nameEndpoint, type QuoteEndpoints } from './quote-endpoint.js';

/**
 * One way NHI's and MRP's quotes differ, named for a reader. Changes with the same `summary` are counted together
 * across policies; `detail` carries each policy's own values.
 */
export interface QuoteChange {
  /** What changed, the same for every policy it applies to, for example `Buildings cover: offered on NHI, not on MRP`. */
  summary: string;
  /** This policy's values, for example `£329.22 on NHI, £301.09 on MRP`, when the summary does not hold them. */
  detail?: string;
  /**
   * The `quoteResult` fields the change was read from, by their own names without the path, for example
   * `buildingsIsAllowed`, when it was read from named fields rather than from a list.
   */
  field?: string;
}

/** What a policy's saved responses say about how its NHI and MRP quotes differ. */
export type QuoteChangesResult =
  | { status: 'compared'; changes: QuoteChange[] }
  | {
      status: 'not-captured';
      /** Why the quotes cannot be compared, for example `no NHI quote response saved`. */
      reason: string;
    };

/** A quote's `quoteResult`, as NHI's quote summary and MRP's `save-details` response both return it. */
type QuoteResultData = Record<string, unknown>;

/** Cover each flow may offer, named for readers, by the `quoteResult` flag that says whether it is offered. */
const coverChecks: readonly { path: string; label: string }[] = [
  { path: 'buildingsInsurance.buildingsIsAllowed', label: 'Buildings cover' },
  { path: 'contentsInsurance.contentsIsAllowed', label: 'Contents cover' }
];

/**
 * Whether personal possessions are covered. When it differs, the listed items (and their total) differ because of it,
 * so they are not compared.
 */
const generalValuablesAllowedPath = 'contentsInsurance.isGeneralValuablesCoveredAllowed';

/** The two personal possessions flags, reported as one change when they move together. */
const possessionsChecks: readonly { path: string; label: string }[] = [
  { path: 'contentsInsurance.isHighRiskHighValueItemsAllowed', label: 'High-risk items cover' },
  { path: generalValuablesAllowedPath, label: 'Personal possessions cover' }
];

/** The total of the listed items included in the quote, which the listed-item checks may already explain. */
const highRiskTotalPath = 'contentsInsurance.highRiskHighValueItemsTotal';

/** Amounts in pounds, named for readers. */
const moneyChecks: readonly { path: string; label: string }[] = [
  { path: 'buildingsInsurance.buildingsSumInsured', label: 'Buildings sum insured' },
  { path: 'contentsInsurance.contentsSumInsured', label: 'Contents sum insured' },
  { path: highRiskTotalPath, label: 'High-risk items total' },
  { path: 'quoteAmounts.yearlyAmount', label: 'Annual premium' },
  { path: 'quoteAmounts.monthlyAmount', label: 'Monthly premium' },
  { path: 'quoteAmounts.depositAmount', label: 'Deposit' },
  { path: 'quoteAmounts.monthlyPaymentAmount', label: 'Total of monthly payments' },
  { path: 'quoteAmounts.adminFee', label: 'Admin fee' }
];

/** Yes/no facts about the quote, named for readers. */
const flagChecks: readonly { path: string; label: string }[] = [
  { path: 'isConditional', label: 'Conditional quote' },
  { path: 'isReferred', label: 'Referral' },
  { path: 'isDeclined', label: 'Decline' },
  { path: 'requiresSpecificTermsCheck', label: 'Specific terms check' }
];

/**
 * Fields that differ on every comparison without meaning a different quote: references and GUIDs of each side's own
 * quote, the agent, formats, defaults one side fills where the other sends nothing, and record IDs. Taken from all 252
 * results with both responses and end points on 2026-10-21; a field that turns out to matter can be removed here.
 */
const noiseFields: ReadonlySet<string> = new Set([
  'policyRefNo',
  'quoteRefNo',
  'quoteGuid',
  'quoteAmounts.artemisQuoteGuid',
  'quoteAmounts.callCentreUserCode',
  'quoteAmounts.selectedPaymentPlanTypeField',
  'quoteAmounts.transactorPolicyDetailsId',
  'startDate',
  'questionSetBackLink',
  'preferredPaymentMethod',
  'unoccDate',
  'tier',
  'originalTier',
  'extPerilsReq',
  'buildingsInsurance.is7500CoverSufficient',
  'buildingsInsurance.propertyRebuildCost',
  'buildingsInsurance.outbuildingRebuildCoverAmount',
  'buildingsInsurance.outbuildingRebuildCoverAmountV5',
  'contentsInsurance.contentsAccidentalDamageIsSelected',
  'jointPolicyHolders[].nickName',
  'jointPolicyHolders[].instance',
  'propertyAddress.addressLookupJson',
  'propertyAddress.addressSearchText'
]);

/**
 * Fields NHI's saved quote leaves unset where MRP's is set, by the value NHI reports (as {@link collectLeaves} writes
 * it). A joint policyholder's relationship comes back `0`, a code that does not exist, whatever the customer answered,
 * and an evidence pack's code comes back `null` though its title and text match MRP's (both found 2026-10-22). Ignored
 * only when every NHI value is the unset one and no MRP value is, so any other difference is still reported.
 */
const nhiUnsetFields: ReadonlyMap<string, string> = new Map([
  ['jointPolicyHolders[].relationship', '0'],
  ['importantInformation.evidencePacks[].transactorCode', 'null']
]);

/** Saved responses that carry a priced quote: a quote summary, or a `save-details` re-quote. */
const quoteResponsePattern = /-GET-quote-summary-|-POST-save-details/;

/** Parts of `quoteResult` the named checks compare as a whole, so the catch-all leaves every field under them alone. */
const checkedPrefixes: readonly string[] = [
  'compulsoryExcesses[]',
  'importantInformation.endorsements[]',
  'quoteListedItems[]'
];

/**
 * Reads a policy's saved NHI and MRP responses and describes how their quotes differ (see {@link compareQuotes}).
 * Nothing is inferred from a result captured before every response was recorded: it is reported as not captured, to be
 * run again.
 * @param folder The policy's `<policyDetailsId>-<historyId>` output folder.
 * @param endpoints Where each flow ended, from the policy's `result.json`; results without them were captured before
 * end points were recorded.
 * @returns The changes, or why the quotes cannot be compared.
 * @throws When a saved response cannot be read or parsed.
 */
export async function readQuoteChanges(folder: string, endpoints?: QuoteEndpoints): Promise<QuoteChangesResult> {
  if (endpoints === undefined) {
    return { status: 'not-captured', reason: 'captured before end points were recorded' };
  }

  const nhi = await readFlowQuoteResult(folder, 'nhi');
  if (nhi === undefined) {
    return { status: 'not-captured', reason: 'no NHI quote response saved' };
  }

  const mrp = await readFlowQuoteResult(folder, 'mrp');
  if (mrp === undefined) {
    return { status: 'not-captured', reason: 'no MRP quote response saved' };
  }

  return { status: 'compared', changes: compareQuotes(nhi, mrp, endpoints) };
}

/**
 * Describes how two quotes differ, in reader's terms: where each flow ended, cover offered, amounts, excesses,
 * endorsements, listed items and yes/no facts, then any other field both quotes have that differs, by name. Listed
 * items and their total are left out when personal possessions cover differs, since that explains them. Noise
 * fields (see {@link noiseFields}) are ignored, `null` and an empty string count as the same, and fields only one
 * response has are left out, since the two responses carry different extras.
 * @param nhi NHI's `quoteResult`.
 * @param mrp MRP's `quoteResult`.
 * @param endpoints Where each flow ended.
 * @returns The changes, in the order above; empty when the quotes match.
 */
export function compareQuotes(nhi: QuoteResultData, mrp: QuoteResultData, endpoints?: QuoteEndpoints): QuoteChange[] {
  const handled = new Set<string>();
  const compareItems = !flagDiffers(nhi, mrp, generalValuablesAllowedPath);
  const changes = [
    ...compareEndpoints(endpoints),
    ...compareCover(nhi, mrp, handled),
    ...compareMoney(nhi, mrp, handled, compareItems),
    ...compareExcesses(nhi, mrp),
    ...compareEndorsements(nhi, mrp),
    ...(compareItems ? compareListedItems(nhi, mrp) : []),
    ...compareFlags(nhi, mrp, handled)
  ];
  return [...changes, ...compareOtherFields(nhi, mrp, handled)];
}

/**
 * Reads a flow's quote (see {@link readLatestQuoteResult}) from its API responses folder, or from the folder results
 * saved before the current names used, when it has none.
 * @returns The `quoteResult`, or `undefined` when neither folder holds a quote response.
 */
async function readFlowQuoteResult(folder: string, flow: FlowName): Promise<QuoteResultData | undefined> {
  return (
    (await readLatestQuoteResult(flowOutputPaths(folder, flow).apiResponses)) ??
    (await readLatestQuoteResult(legacyFlowOutputPaths(folder, flow).apiResponses))
  );
}

/**
 * Reads the `quoteResult` of the last quote response a flow's page received: its quote summary, or a later
 * `save-details` re-quote when the page priced the quote again (NHI's page can do this too). The responses are
 * numbered in the order they arrived, and the last one is the quote the page showed.
 * @returns The `quoteResult`, or `undefined` when the folder or a quote response is missing.
 */
async function readLatestQuoteResult(folder: string): Promise<QuoteResultData | undefined> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return undefined;
  }

  const name = names
    .filter((file) => quoteResponsePattern.test(file))
    .sort()
    .pop();
  if (name === undefined) {
    return undefined;
  }

  const path = join(folder, name);
  const saved = parseJson((await readOptionalTextFile(path)) ?? 'null', path);
  const quoteResult = isRecord(saved) && isRecord(saved['body']) ? saved['body']['quoteResult'] : undefined;
  return isRecord(quoteResult) ? quoteResult : undefined;
}

function compareEndpoints(endpoints: QuoteEndpoints | undefined): QuoteChange[] {
  return endpoints === undefined || endpoints.nhi === endpoints.tcas
    ? []
    : [{ summary: `End point: NHI ${nameEndpoint(endpoints.nhi)}, MRP ${nameEndpoint(endpoints.tcas)}` }];
}

function compareCover(nhi: QuoteResultData, mrp: QuoteResultData, handled: Set<string>): QuoteChange[] {
  const changes = coverChecks.flatMap(({ path, label }) => compareOffered(nhi, mrp, path, label, 'offered', handled));
  const [highRisk, possessions] = possessionsChecks.map(({ path }) => [readPath(nhi, path), readPath(mrp, path)]);
  const together =
    highRisk !== undefined &&
    possessions !== undefined &&
    highRisk[0] === possessions[0] &&
    highRisk[1] === possessions[1] &&
    typeof highRisk[0] === 'boolean' &&
    typeof highRisk[1] === 'boolean' &&
    highRisk[0] !== highRisk[1];
  if (together) {
    possessionsChecks.forEach(({ path }) => handled.add(path));
    return [
      ...changes,
      {
        summary: `Personal possessions and high-risk items: ${offeredOn(highRisk[0] === true, 'allowed')}`,
        field: nameFields(possessionsChecks.map(({ path }) => path))
      }
    ];
  }

  return [
    ...changes,
    ...possessionsChecks.flatMap(({ path, label }) => compareOffered(nhi, mrp, path, label, 'allowed', handled))
  ];
}

/** Reports amounts that differ, leaving out the high-risk items total when the listed items are not compared. */
function compareMoney(
  nhi: QuoteResultData,
  mrp: QuoteResultData,
  handled: Set<string>,
  compareItems: boolean
): QuoteChange[] {
  return moneyChecks.flatMap(({ path, label }) => {
    handled.add(path);
    const [a, b] = [readPath(nhi, path), readPath(mrp, path)];
    const skipTotal = path === highRiskTotalPath && (!compareItems || isExplainedByListedItems(a, b, nhi, mrp));
    return sameValue(a, b) || skipTotal
      ? []
      : [{ summary: `${label} differs`, detail: `${money(a)} on NHI, ${money(b)} on MRP`, field: nameFields([path]) }];
  });
}

/**
 * Whether the high-risk items total differs by exactly the value of the listed items one side includes and the other
 * does not, so the listed-item changes already report it. Items both sides include alike cancel out.
 */
function isExplainedByListedItems(
  nhiTotal: unknown,
  mrpTotal: unknown,
  nhi: QuoteResultData,
  mrp: QuoteResultData
): boolean {
  return (
    typeof nhiTotal === 'number' &&
    typeof mrpTotal === 'number' &&
    nhiTotal - mrpTotal === includedItemsValue(nhi) - includedItemsValue(mrp)
  );
}

function compareExcesses(nhi: QuoteResultData, mrp: QuoteResultData): QuoteChange[] {
  const [a, b] = [excessesByKey(nhi), excessesByKey(mrp)];
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((key) => {
    const [left, right] = [a.get(key), b.get(key)];
    const name = left?.description ?? right?.description ?? key;
    if (right === undefined) {
      return [{ summary: `Excess only on NHI: ${name}`, detail: money(left?.amount) }];
    }

    if (left === undefined) {
      return [{ summary: `Excess only on MRP: ${name}`, detail: money(right.amount) }];
    }

    return sameValue(left.amount, right.amount)
      ? []
      : [{ summary: `${name} differs`, detail: `${money(left.amount)} on NHI, ${money(right.amount)} on MRP` }];
  });
}

function compareEndorsements(nhi: QuoteResultData, mrp: QuoteResultData): QuoteChange[] {
  const [a, b] = [endorsementsByCode(nhi), endorsementsByCode(mrp)];
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((code) => {
    const [left, right] = [a.get(code), b.get(code)];
    if (right === undefined) {
      return [{ summary: `Endorsement only on NHI: ${code} (${left?.title ?? 'no title'})` }];
    }

    if (left === undefined) {
      return [{ summary: `Endorsement only on MRP: ${code} (${right.title ?? 'no title'})` }];
    }

    return left.text === right.text
      ? []
      : [{ summary: `Endorsement wording differs: ${code} (${left.title ?? 'no title'})` }];
  });
}

/**
 * Compares the listed items, matching them by category, value and away-from-home cover (the two sides number them
 * differently), and naming each by its category and value rather than the description the customer typed. Reports items
 * only one side lists, and matched items included in one quote but not the other.
 */
function compareListedItems(nhi: QuoteResultData, mrp: QuoteResultData): QuoteChange[] {
  const unmatched = listedItems(mrp);
  const changes: QuoteChange[] = [];
  for (const item of listedItems(nhi)) {
    const index = unmatched.findIndex((other) => itemKey(other) === itemKey(item));
    if (index < 0) {
      changes.push({ summary: 'Listed item only on NHI', detail: itemName(item) });
      continue;
    }

    const [other] = unmatched.splice(index, 1);
    const included = item['includeInQuote'];
    if (
      typeof included === 'boolean' &&
      typeof other?.['includeInQuote'] === 'boolean' &&
      included !== other['includeInQuote']
    ) {
      changes.push({ summary: `Listed item: ${offeredOn(included, 'included')}`, detail: itemName(item) });
    }
  }

  return [...changes, ...unmatched.map((item) => ({ summary: 'Listed item only on MRP', detail: itemName(item) }))];
}

function compareFlags(nhi: QuoteResultData, mrp: QuoteResultData, handled: Set<string>): QuoteChange[] {
  return flagChecks.flatMap(({ path, label }) => {
    handled.add(path);
    const [a, b] = [readPath(nhi, path), readPath(mrp, path)];
    return typeof a === 'boolean' && typeof b === 'boolean' && a !== b
      ? [{ summary: `${label}: ${a ? 'yes on NHI, no on MRP' : 'no on NHI, yes on MRP'}`, field: nameFields([path]) }]
      : [];
  });
}

/**
 * Reports, by field, every other leaf both quotes have that differs. Array elements are compared as a set of values
 * per field (so a change of order alone is not reported), and fields the named checks or the noise list cover are left
 * out, as are fields NHI leaves unset (see {@link nhiUnsetFields}).
 */
function compareOtherFields(nhi: QuoteResultData, mrp: QuoteResultData, handled: Set<string>): QuoteChange[] {
  const [a, b] = [collectLeaves(nhi), collectLeaves(mrp)];
  return [...a.keys()]
    .filter((path) => b.has(path))
    .filter((path) => !handled.has(path) && !noiseFields.has(path))
    .filter((path) => !checkedPrefixes.some((prefix) => path.startsWith(`${prefix}.`)))
    .filter((path) => a.get(path) !== b.get(path))
    .filter((path) => !isUnsetOnNhiOnly(a.get(path), b.get(path), nhiUnsetFields.get(path)))
    .sort()
    .map((path) => ({
      summary: `Other data differs: ${path}`,
      detail: `${shorten(a.get(path))} on NHI, ${shorten(b.get(path))} on MRP`
    }));
}

/**
 * Whether a field's values, as {@link collectLeaves} joins them, are all `unset` on NHI and none `unset` on MRP; never
 * when the field has no unset value. The fields this is used for hold numbers and codes without commas, so splitting
 * the joined values is safe.
 */
function isUnsetOnNhiOnly(
  nhiValues: string | undefined,
  mrpValues: string | undefined,
  unset: string | undefined
): boolean {
  const split = (values: string | undefined) => (values ?? '').split(', ');
  return (
    unset !== undefined &&
    split(nhiValues).every((value) => value === unset) &&
    split(mrpValues).every((value) => value !== unset)
  );
}

/** Reports a yes/no cover flag that differs, worded with `verb` (`offered`, `allowed`). */
/** Whether a yes/no flag is set on both sides and differs. */
function flagDiffers(nhi: QuoteResultData, mrp: QuoteResultData, path: string): boolean {
  const [a, b] = [readPath(nhi, path), readPath(mrp, path)];
  return typeof a === 'boolean' && typeof b === 'boolean' && a !== b;
}

function compareOffered(
  nhi: QuoteResultData,
  mrp: QuoteResultData,
  path: string,
  label: string,
  verb: string,
  handled: Set<string>
): QuoteChange[] {
  handled.add(path);
  const [a, b] = [readPath(nhi, path), readPath(mrp, path)];
  return typeof a === 'boolean' && typeof b === 'boolean' && a !== b
    ? [{ summary: `${label}: ${offeredOn(a, verb)}`, field: nameFields([path]) }]
    : [];
}

function excessesByKey(quote: QuoteResultData): Map<string, { description?: string; amount: unknown }> {
  const excesses = readPath(quote, 'compulsoryExcesses');
  return new Map(
    (Array.isArray(excesses) ? excesses : []).filter(isRecord).map((excess) => [
      String(excess['key'] ?? excess['description']),
      {
        description: typeof excess['description'] === 'string' ? excess['description'] : undefined,
        amount: excess['amount']
      }
    ])
  );
}

function endorsementsByCode(quote: QuoteResultData): Map<string, { title?: string; text: unknown }> {
  const endorsements = readPath(quote, 'importantInformation.endorsements');
  return new Map(
    (Array.isArray(endorsements) ? endorsements : []).filter(isRecord).map((endorsement) => [
      String(endorsement['transactorCode'] ?? endorsement['title']),
      {
        title: typeof endorsement['title'] === 'string' ? endorsement['title'] : undefined,
        text: endorsement['text']
      }
    ])
  );
}

function listedItems(quote: QuoteResultData): Record<string, unknown>[] {
  const items = readPath(quote, 'quoteListedItems');
  return (Array.isArray(items) ? items : []).filter(isRecord);
}

/** The total value of a quote's listed items included in the quote. */
function includedItemsValue(quote: QuoteResultData): number {
  return listedItems(quote)
    .filter((item) => item['includeInQuote'] === true)
    .reduce((total, item) => total + (typeof item['value'] === 'number' ? item['value'] : 0), 0);
}

/** What identifies a listed item on both sides: its category, value and whether it is covered away from home. */
function itemKey(item: Record<string, unknown>): string {
  return JSON.stringify([item['category'], item['value'], item['isAwayFromHomeCoverRequired']]);
}

/** Names a listed item by its category and value, never by the description the customer typed. */
function itemName(item: Record<string, unknown>): string {
  return `${String(item['categoryTitleDescription'] ?? 'item')}, ${money(item['value'])}`;
}

/**
 * Flattens a quote into its leaf fields, with array indices written `[]` and each field's values (from every array
 * element) sorted and joined, such as `"BC"` or `0, 3`, so the comparison ignores order. `null` and empty strings are
 * written the same.
 */
function collectLeaves(quote: QuoteResultData): Map<string, string> {
  const values = new Map<string, unknown[]>();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((element) => walk(element, `${path}[]`));
    } else if (isRecord(value)) {
      Object.entries(value).forEach(([key, child]) => walk(child, path === '' ? key : `${path}.${key}`));
    } else {
      values.set(path, [...(values.get(path) ?? []), value === '' ? null : value]);
    }
  };

  walk(quote, '');
  return new Map(
    [...values].map(([path, list]) => [
      path,
      list
        .map((value) => JSON.stringify(value))
        .sort()
        .join(', ')
    ])
  );
}

/** Reads a dotted path, such as `buildingsInsurance.buildingsIsAllowed`. */
function readPath(quote: QuoteResultData, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), quote);
}

/** Names dotted `quoteResult` paths by their last part, such as `adminFee` for `quoteAmounts.adminFee`. */
function nameFields(paths: readonly string[]): string {
  return paths.map((path) => path.split('.').pop()).join(', ');
}

function offeredOn(onNhi: boolean, verb: string): string {
  return onNhi ? `${verb} on NHI, not on MRP` : `not ${verb} on NHI, ${verb} on MRP`;
}

/** Whether two values match, counting `null`, `undefined` and an empty string as the same. */
function sameValue(a: unknown, b: unknown): boolean {
  const blank = (value: unknown) => value === null || value === undefined || value === '';
  return (blank(a) && blank(b)) || a === b;
}

/** Formats an amount in pounds, keeping any third decimal place so a rounding difference shows. */
function money(value: unknown): string {
  return typeof value === 'number'
    ? `£${value.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 3 })}`
    : 'none';
}

/** Shortens a catch-all field's values for the detail line. */
function shorten(values: string | undefined): string {
  const text = values === undefined || values === '' ? 'nothing' : values;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
