import { diffArrays } from 'diff';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { color, failureColor } from './color.js';
import type { ComparisonReportBasics } from './compare.js';
import { isMissing, parseJson, readDirectoryNames, readOptionalTextFile } from './fs-helpers.js';
import { fetchedHistoryId, filterMissingMrpFiles } from './mrp-fetch.js';
import { readQuoteGuidList } from './quote-guid-list.js';
import { readQuoteResult, type QuoteResult } from './quote-result.js';
import { outputPath, policyFolderPattern } from './output-paths.js';

/** OCR confidence (0-100) below which a region's text change is flagged as probably misread. */
const lowOcrConfidence = 60;

/** How many of the most common text changes to list. */
const commonTextChangeLimit = 10;

/** Flows whose failure page, `<flow>-failed.html` in the policy's folder, is checked for Oops. */
const oopsFlows = [
  { flow: 'NHI', file: 'nhi-failed.html' },
  { flow: 'TCAS', file: 'tcas-failed.html' }
] as const;

/** The Oops heading quote-page stops on (see `OopsError`). */
const oopsHeadingPattern = /<h[1-3][^>]*>\s*Oops\s*<\/h[1-3]>/i;

/** First line of a capture failure, shared by every such failure, so it is left out of the reasons. */
const captureFailedHeading = 'Quote capture failed; comparison skipped.';

/** A region whose recognised text changed, reduced to the lines that differ. */
export interface TextDifference {
  regionId: number;
  removed: string[];
  added: string[];
  /**
   * True when a side with text has OCR confidence below 60, so the change may be a misreading. A side with no text
   * (for example a region below the end of the shorter page) is not counted.
   */
  lowConfidence: boolean;
}

/** A policy whose NHI and TCAS captures were compared. */
export interface ComparedPolicy {
  name: string;
  changedPixels: number;
  changedPercent: number;
  /** For example `1440×7565 vs 1440×7600`, when the two screenshots differ in size. */
  sizeDifference?: string;
  textDifferences: TextDifference[];
  /** True when NHI and TCAS listed the endorsements in different orders, put in standard order before comparing. */
  endorsementOrderDiffers: boolean;
}

/** Everything the summarise command found in the output folder. */
export interface QuoteResultsSummary {
  root: string;
  compared: ComparedPolicy[];
  declined: string[];
  failed: (QuoteResult & { name: string })[];
  /** Policy folders with neither a `result.json` nor a `report.json`. */
  unrecorded: string[];
  /** When each policy's last run started, from its `result.json`; failure pages older than this are stale. */
  runStarts: Map<string, string>;
}

/** Where the summarise command looks; relative paths resolve from the current working directory. */
export interface SummariseOptions {
  /** Folder holding the policy folders (default: the output folder, see {@link outputPath}). */
  root?: string;
  /** GUID list (`QUOTE_GUID_LIST_PATH`); the GUID list totals are left out unless this and the next are set. */
  guidListPath?: string;
  /** mrp-and-quote's output folder (`MRP_AND_QUOTE_OUTPUT_DIR`), checked for each listed policy's MRP record. */
  mrpAndQuoteOutputDir?: string;
  /** Print only the policies whose screenshots differ, and their count, leaving out failures, MRP records and Oops pages. */
  differentOnly?: boolean;
}

/** How many of one flow's failure pages showed Oops, and how many of those policies still compared or declined. */
export interface OopsCount {
  flow: 'NHI' | 'TCAS';
  total: number;
  /** Policies whose later attempt (for NHI, the replacement quote GUID) compared or declined. */
  recovered: number;
}

/** How far the GUID list has got: its size, the policies with no result yet, and the MRP records not retrieved. */
export interface GuidListStatus {
  path: string;
  total: number;
  /** Listed policies with no recorded result: no `<policyDetailsId>-1` folder, or one without a result. */
  withoutResult: string[];
  /** Listed policies with no `<policyDetailsId>-1-mrp.json` in mrp-and-quote's output folder. */
  missingMrp: string[];
}

/**
 * Prints a summary of every quote-page result in the output folder: the visual and text differences of each
 * compared policy, the most common text changes, each failed policy with its issues, failures grouped by reason,
 * the MRP records not retrieved, and the totals (including the GUID list size and Oops pages). With `differentOnly`, it
 * prints only the differences, the most common text changes and how many compared policies differ.
 * @param options Folder to read, optionally the GUID list and MRP folder, and whether to print only the differences.
 * @throws When a `result.json`, `report.json` or the GUID list cannot be read or parsed.
 */
export async function summariseQuoteResults(options: SummariseOptions = {}): Promise<void> {
  const summary = await collectQuoteResults(options.root ?? outputPath());
  if (options.differentOnly === true) {
    printDifferentPolicies(summary);
    return;
  }

  const oops = await countOopsPages(summary);
  const guidList =
    options.guidListPath === undefined || options.mrpAndQuoteOutputDir === undefined
      ? undefined
      : await collectGuidListStatus(options.guidListPath, options.mrpAndQuoteOutputDir, summary);
  printQuoteResultsSummary(summary, oops, guidList);
}

/**
 * Reads each `<root>/<policyDetailsId>-<historyId>` folder; other folders, such as the OCR cache, are
 * skipped. A folder's `result.json` (written by quote-page) gives its outcome; a folder with
 * only a `report.json`, from a run before results were saved, counts as compared, since a report exists only when
 * both sides were captured.
 * @param root Folder holding the policy folders.
 * @returns The compared, declined, failed and unrecorded policies, each sorted by folder name.
 * @throws When a `result.json` or `report.json` cannot be read or parsed.
 */
export async function collectQuoteResults(root: string): Promise<QuoteResultsSummary> {
  const summary: QuoteResultsSummary = {
    root: resolve(root),
    compared: [],
    declined: [],
    failed: [],
    unrecorded: [],
    runStarts: new Map()
  };
  const names = (await readDirectoryNames(summary.root)).filter((name) => policyFolderPattern.test(name));
  // Read in parallel (there can be over a thousand folders), then sort in folder order.
  const folders = await Promise.all(names.map((name) => readPolicyFolder(summary.root, name)));
  for (const { name, result, report } of folders) {
    if (result !== undefined) {
      summary.runStarts.set(name, result.startedAt);
    }

    if (result?.outcome === 'failed') {
      summary.failed.push({ ...result, name });
    } else if (result?.outcome === 'declined') {
      summary.declined.push(name);
    } else if (report === undefined) {
      summary.unrecorded.push(name);
    } else {
      summary.compared.push(summariseReport(name, report, result?.endorsementOrder !== undefined));
    }
  }

  return summary;
}

/**
 * Counts each flow's saved failure pages (`nhi-failed.html`, `tcas-failed.html` in each policy's folder) that show the
 * Oops heading, and how many of those policies still compared or declined, for example after NHI retried with a
 * replacement quote GUID. A page saved before its policy's last recorded run started is left over from an earlier run
 * (one that stopped before clearing old output, such as for a missing MRP), so it is not counted.
 * @param summary The results summary, giving the folder to read, which policies recovered and when each last run
 * started.
 * @returns One count for NHI, then one for TCAS.
 * @throws When a failure page cannot be read.
 */
export async function countOopsPages(summary: QuoteResultsSummary): Promise<OopsCount[]> {
  const recoveredNames = new Set([...summary.compared.map(({ name }) => name), ...summary.declined]);
  const names = (await readDirectoryNames(summary.root)).filter((name) => policyFolderPattern.test(name));
  return Promise.all(
    oopsFlows.map(async ({ flow, file }) => {
      const oops = await Promise.all(
        names.map((name) => isCurrentOopsPage(join(summary.root, name, file), summary.runStarts.get(name)))
      );
      const oopsNames = names.filter((_name, index) => oops[index] === true);
      return {
        flow,
        total: oopsNames.length,
        recovered: oopsNames.filter((name) => recoveredNames.has(name)).length
      };
    })
  );
}

/**
 * Compares the GUID list with the policy folders and mrp-and-quote's output folder.
 * @param guidListPath GUID list file, one policy ID per line.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder.
 * @param summary The results summary, to tell which listed policies have run.
 * @returns The list's size, its policies with no recorded result, and those whose MRP record was not retrieved.
 * @throws When the GUID list cannot be read or has an invalid line.
 */
export async function collectGuidListStatus(
  guidListPath: string,
  mrpAndQuoteOutputDir: string,
  summary: QuoteResultsSummary
): Promise<GuidListStatus> {
  const guids = await readQuoteGuidList(guidListPath);
  const names = new Set([
    ...summary.compared.map(({ name }) => name),
    ...summary.declined,
    ...summary.failed.map(({ name }) => name)
  ]);
  return {
    path: resolve(guidListPath),
    total: guids.length,
    withoutResult: guids.filter((guid) => !names.has(`${guid}-${fetchedHistoryId}`)),
    missingMrp: await filterMissingMrpFiles(guids, mrpAndQuoteOutputDir)
  };
}

/**
 * Lists the compared policies whose NHI and TCAS screenshots differ (any changed pixel), the policies the summary
 * counts as different, for `quote-pages -- retry-different`.
 * @param summary The results summary.
 * @returns Each different policy's ID and history ID, taken from its folder name, in folder order.
 */
export function listDifferentPolicies(summary: QuoteResultsSummary): { policyDetailsId: string; historyId: number }[] {
  return summary.compared
    .filter(({ changedPixels }) => changedPixels > 0)
    .map(({ name }) => {
      const separator = name.lastIndexOf('-');
      return { policyDetailsId: name.slice(0, separator), historyId: Number(name.slice(separator + 1)) };
    });
}

/**
 * Groups the text differences of all compared policies by the lines removed and added, most common first.
 * @param compared Compared policies.
 * @returns Each distinct change, for example `£137.63 → £137.62`, with the number of regions showing it.
 */
export function countTextChanges(compared: ComparedPolicy[]): { change: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { removed, added } of compared.flatMap((policy) => policy.textDifferences)) {
    const change = `${describeLines(removed)} → ${describeLines(added)}`;
    counts.set(change, (counts.get(change) ?? 0) + 1);
  }

  return [...counts]
    .map(([change, count]) => ({ change, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.change.localeCompare(b.change)));
}

/**
 * Groups failed policies by the reasons in their issues, ignoring URLs, file paths and IDs so the same error on
 * different policies counts once per policy.
 * @param failed Failed policies.
 * @returns Each distinct reason with the number of policies reporting it, most common first.
 */
export function countFailureReasons(failed: QuoteResult[]): { reason: string; count: number; validation: boolean }[] {
  const counts = new Map<string, { count: number; validation: boolean }>();
  for (const { issues, validation } of failed) {
    const reasons = new Set(issues.filter((issue) => issue !== captureFailedHeading).map(normaliseIssue));
    for (const reason of reasons) {
      const entry = counts.get(reason);
      counts.set(reason, { count: (entry?.count ?? 0) + 1, validation: (entry?.validation ?? true) && validation });
    }
  }

  return [...counts]
    .map(([reason, entry]) => ({ reason, ...entry }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.reason.localeCompare(b.reason)));
}

/**
 * Removes what differs between policies from a failure issue: URLs (with their parentheses), file paths, and
 * policy or quote GUIDs, with or without dashes. A POSIX path must start with `/` and end in a file name with an
 * extension, so dates (`DD/MM/YYYY`) and slash-separated words are kept.
 * @param issue One line of a failure message.
 * @returns The issue with those parts replaced by `<url>`, `<path>` and `<id>`.
 */
export function normaliseIssue(issue: string): string {
  return issue
    .replace(/\s*\(https?:\/\/[^)\s]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:\\\S+|(?<![\w/])(?:\/[\w.-]+)+\/[\w-]+\.\w+/g, '<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{32}\b/gi, '<id>')
    .trim();
}

interface OcrReading {
  text: string;
  confidence: number | null;
}

interface ReportRegion {
  id: number;
  before: OcrReading;
  after: OcrReading;
  textChanges: unknown[];
}

interface ComparisonReport extends ComparisonReportBasics {
  regions: ReportRegion[];
}

function printQuoteResultsSummary(
  summary: QuoteResultsSummary,
  oops: OopsCount[],
  guidList: GuidListStatus | undefined
): void {
  console.log(color.Cyan(`Quote results summary (${summary.root})`));
  printDifferenceSections(summary.compared);
  printFailedPolicies(summary.failed);
  printFailureReasons(countFailureReasons(summary.failed));
  if (summary.unrecorded.length > 0) {
    console.log(`\n${color.Gray(`Policies without a result: ${summary.unrecorded.join(', ')}`)}`);
  }

  printMissingMrpRecords(guidList?.missingMrp ?? []);
  printTotals(summary, oops, guidList);
}

function printDifferentPolicies({ root, compared }: QuoteResultsSummary): void {
  const count = compared.filter((policy) => policy.changedPixels > 0).length;
  const different = `${count} different`;
  console.log(color.Cyan(`Different quote results (${root})`));
  printDifferenceSections(compared, root);
  console.log(`\n${color.Cyan('Totals')}`);
  console.log(`${count > 0 ? color.Yellow(different) : different} of ${compared.length} compared.`);
}

/**
 * Prints the visual-only differences, text differences and most common text changes. With `folderRoot`, each policy
 * is labelled with its full policy folder path, so terminals can open it, rather than its folder name.
 */
function printDifferenceSections(compared: ComparedPolicy[], folderRoot?: string): void {
  printVisualOnlyDifferences(compared.filter(isVisualOnly), folderRoot);
  printTextDifferences(
    compared.filter((policy) => policy.textDifferences.length > 0),
    folderRoot
  );
  printCommonTextChanges(countTextChanges(compared).filter(({ count }) => count > 1));
}

function printVisualOnlyDifferences(policies: ComparedPolicy[], folderRoot: string | undefined): void {
  if (policies.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`Visual-only differences (${policies.length})`)}`);
  for (const policy of [...policies].sort((a, b) => b.changedPercent - a.changedPercent)) {
    console.log(`  ${policyLabel(policy.name, folderRoot)}  ${describeChange(policy)}`);
  }
}

function printTextDifferences(policies: ComparedPolicy[], folderRoot: string | undefined): void {
  if (policies.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`Text differences (${policies.length})`)}`);
  for (const policy of policies) {
    const regions = policy.textDifferences.length;
    const label = policyLabel(policy.name, folderRoot);
    console.log(
      `${label}  ${describeChange(policy)}, ${regions} ${regions === 1 ? 'region' : 'regions'} with text changes`
    );
    for (const { regionId, removed, added, lowConfidence } of policy.textDifferences) {
      console.log(`  Region ${regionId}${lowConfidence ? color.Gray(' (low OCR confidence)') : ''}`);
      removed.forEach((line) => console.log(`    ${color.Red(`- ${line}`)}`));
      added.forEach((line) => console.log(`    ${color.Green(`+ ${line}`)}`));
    }
  }
}

function printCommonTextChanges(changes: { change: string; count: number }[]): void {
  if (changes.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan('Most common text changes')}`);
  for (const { change, count } of changes.slice(0, commonTextChangeLimit)) {
    console.log(`  ${count}× ${change}`);
  }
}

function printFailedPolicies(failed: (QuoteResult & { name: string })[]): void {
  if (failed.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`Failed policies (${failed.length})`)}`);
  for (const { name, issues, validation } of failed) {
    console.log(name);
    issues.forEach((issue) => console.log(`  ${failureColor(validation)(issue)}`));
  }
}

function printFailureReasons(reasons: { reason: string; count: number; validation: boolean }[]): void {
  if (reasons.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan('Failures by reason')}`);
  for (const { reason, count, validation } of reasons) {
    console.log(`  ${count}× ${failureColor(validation)(reason)}`);
  }
}

function printMissingMrpRecords(missingMrp: string[]): void {
  if (missingMrp.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`MRP records not retrieved (${missingMrp.length})`)}`);
  missingMrp.forEach((policyDetailsId) => console.log(`  ${color.Yellow(policyDetailsId)}`));
}

function printTotals(
  { compared, declined, failed, unrecorded }: QuoteResultsSummary,
  oops: OopsCount[],
  guidList: GuidListStatus | undefined
): void {
  const identical = compared.filter((policy) => policy.changedPixels === 0).length;
  const withText = compared.filter((policy) => policy.textDifferences.length > 0).length;
  const total = compared.length + declined.length + failed.length + unrecorded.length;
  const different = `${compared.length - identical} different`;
  const failedCount = `${failed.length} failed`;
  const allValidation = failed.every((result) => result.validation);
  console.log(`\n${color.Cyan('Totals')}`);
  printGuidListTotals(guidList);
  console.log(
    `${total} policies: ${compared.length} compared (${color.Green(`${identical} identical`)}, ${
      identical === compared.length ? different : color.Yellow(different)
    }, ${withText} with text changes), ${declined.length} both declined, ${
      failed.length > 0 ? failureColor(allValidation)(failedCount) : failedCount
    }${unrecorded.length > 0 ? `, ${unrecorded.length} without a result` : ''}.`
  );
  const oopsCounts = oops.map(
    ({ flow, total, recovered }) => `${flow} ${total} (${recovered} later compared or declined)`
  );
  console.log(`Oops pages: ${oopsCounts.join(', ')}.`);
  const reordered = compared.filter((policy) => policy.endorsementOrderDiffers);
  if (reordered.length > 0) {
    const identicalReordered = reordered.filter((policy) => policy.changedPixels === 0).length;
    console.log(
      `Endorsement order: ${reordered.length} compared after putting NHI's and TCAS's different orders in standard order (${identicalReordered} then identical).`
    );
  }
}

function printGuidListTotals(guidList: GuidListStatus | undefined): void {
  if (guidList === undefined) {
    console.log(color.Gray('GUID list skipped: QUOTE_GUID_LIST_PATH and MRP_AND_QUOTE_OUTPUT_DIR are not both set.'));
    return;
  }

  const { path, total, withoutResult, missingMrp } = guidList;
  const notRetrieved = `${missingMrp.length} MRP records not retrieved`;
  console.log(
    `GUID list: ${total} policies (${path}); ${total - withoutResult.length} with a result, ${
      withoutResult.length
    } without; ${missingMrp.length > 0 ? color.Yellow(notRetrieved) : notRetrieved}.`
  );
}

function isVisualOnly(policy: ComparedPolicy): boolean {
  return policy.changedPixels > 0 && policy.textDifferences.length === 0;
}

function policyLabel(name: string, folderRoot: string | undefined): string {
  return folderRoot === undefined ? name : join(folderRoot, name);
}

function describeChange(policy: ComparedPolicy): string {
  const change = `${policy.changedPercent.toFixed(2)}% changed`;
  return policy.sizeDifference === undefined ? change : `${change}, page sizes differ: ${policy.sizeDifference}`;
}

function describeLines(lines: string[]): string {
  return lines.length === 0 ? '(nothing)' : lines.join(' / ');
}

function summariseReport(name: string, report: ComparisonReport, endorsementOrderDiffers: boolean): ComparedPolicy {
  const { before, after } = report.dimensions;
  const sameSize = before.width === after.width && before.height === after.height;
  return {
    name,
    changedPixels: report.changedPixels,
    changedPercent: report.changedPercent,
    sizeDifference: sameSize ? undefined : `${before.width}×${before.height} vs ${after.width}×${after.height}`,
    textDifferences: report.regions
      .filter((region) => region.textChanges.length > 0)
      .map(diffRegionLines)
      .filter((difference) => difference.removed.length + difference.added.length > 0),
    endorsementOrderDiffers
  };
}

/**
 * Compares a region's OCR text line by line, so a change is shown in context (for example `£137.63` → `£137.62`
 * rather than the changed words `63` → `62`). Blank lines and surrounding whitespace are ignored.
 */
function diffRegionLines(region: ReportRegion): TextDifference {
  const removed: string[] = [];
  const added: string[] = [];
  for (const part of diffArrays(textLines(region.before.text), textLines(region.after.text))) {
    if (part.removed) {
      removed.push(...part.value);
    } else if (part.added) {
      added.push(...part.value);
    }
  }

  return {
    regionId: region.id,
    removed,
    added,
    lowConfidence: [region.before, region.after].some(
      ({ text, confidence }) => text.trim().length > 0 && (confidence === null || confidence < lowOcrConfidence)
    )
  };
}

function textLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPolicyFolder(
  root: string,
  name: string
): Promise<{ name: string; result: QuoteResult | undefined; report: ComparisonReport | undefined }> {
  const directory = join(root, name);
  const result = await readQuoteResult(directory);
  const needsReport = result === undefined || result.outcome === 'compared';
  return { name, result, report: needsReport ? await readComparisonReport(join(directory, 'report.json')) : undefined };
}

/**
 * True when the page exists, shows Oops and was saved during the policy's last recorded run (or no run was recorded).
 */
async function isCurrentOopsPage(path: string, runStartedAt: string | undefined): Promise<boolean> {
  let modified: number;
  try {
    modified = (await stat(path)).mtimeMs;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  if (runStartedAt !== undefined && modified < Date.parse(runStartedAt)) {
    return false;
  }

  return oopsHeadingPattern.test(await readFile(path, 'utf8'));
}

async function readComparisonReport(path: string): Promise<ComparisonReport | undefined> {
  const content = await readOptionalTextFile(path);
  if (content === undefined) {
    return undefined;
  }

  const report = parseJson(content, path);
  if (!isComparisonReport(report)) {
    throw new Error(`Comparison report must have dimensions, changedPixels, changedPercent and regions: ${path}`);
  }

  return report;
}

function isComparisonReport(value: unknown): value is ComparisonReport {
  return (
    value !== null &&
    typeof value === 'object' &&
    'dimensions' in value &&
    value.dimensions !== null &&
    typeof value.dimensions === 'object' &&
    'changedPixels' in value &&
    typeof value.changedPixels === 'number' &&
    'changedPercent' in value &&
    typeof value.changedPercent === 'number' &&
    'regions' in value &&
    Array.isArray(value.regions)
  );
}
