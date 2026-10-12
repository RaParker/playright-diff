import { diffArrays } from 'diff';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { color, failureColor } from './color.js';
import { fetchedHistoryId, filterMissingMrpFiles } from './mrp-fetch.js';
import { readQuoteGuidList } from './quote-guid-list.js';
import { readQuoteResult, type QuoteResult } from './quote-result.js';

/** OCR confidence (0-100) below which a region's text change is flagged as probably misread. */
const lowOcrConfidence = 60;

/** How many of the most common text changes to list. */
const commonTextChangeLimit = 10;

/** A quote-page output folder, `<policyDetailsId>-<historyId>`; others (such as `.ocr-cache`) are ignored. */
const policyFolderPattern = /^[0-9a-f]{32}-\d+$/i;

/** A flow's failure page, `<policyDetailsId>-<historyId>-<flow>-failed.html`, saved in the screenshots folder. */
const failurePagePattern = /^([0-9a-f]{32}-\d+)-(nhi|tcas)-failed\.html$/i;

/** The Oops heading quote-page stops on (see `OopsError`). */
const oopsHeadingPattern = /<h[1-3][^>]*>\s*Oops\s*<\/h[1-3]>/i;

/** First line of a capture failure, shared by every such failure, so it is left out of the reasons. */
const captureFailedHeading = 'Quote capture failed; comparison skipped.';

/** A region whose recognised text changed, reduced to the lines that differ. */
export interface TextDifference {
  regionId: number;
  removed: string[];
  added: string[];
  /** True when either side's OCR confidence is below 60, so the change may be a misreading. */
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
}

/** Everything the summarise command found in a comparisons folder. */
export interface QuoteResultsSummary {
  root: string;
  compared: ComparedPolicy[];
  declined: string[];
  failed: (QuoteResult & { name: string })[];
  /** Policy folders with neither a `result.json` nor a `report.json`. */
  unrecorded: string[];
}

/** Where the summarise command looks; relative paths resolve from the current working directory. */
export interface SummariseOptions {
  /** Comparisons folder (default: `comparisons`). */
  root?: string;
  /** Screenshots folder, searched for Oops failure pages (default: `screenshots`). */
  screenshots?: string;
  /** GUID list (`QUOTE_GUID_LIST_PATH`); the GUID list totals are left out unless this and the next are set. */
  guidListPath?: string;
  /** mrp-and-quote's output folder (`MRP_AND_QUOTE_OUTPUT_DIR`), checked for each listed policy's MRP record. */
  mrpAndQuoteOutputDir?: string;
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
  /** Listed policies with no `comparisons/<policyDetailsId>-1` folder. */
  notRun: string[];
  /** Listed policies with no `<policyDetailsId>-1-mrp.json` in mrp-and-quote's output folder. */
  missingMrp: string[];
}

/**
 * Prints a summary of every quote-page result in a comparisons folder: the visual and text differences of each
 * compared policy, the most common text changes, each failed policy with its issues, failures grouped by reason,
 * the MRP records not retrieved, and the totals (including the GUID list size and Oops pages).
 * @param options Folders to read, and optionally the GUID list and MRP folder.
 * @throws When a `result.json`, `report.json` or the GUID list cannot be read or parsed.
 */
export async function summariseQuoteResults(options: SummariseOptions = {}): Promise<void> {
  const summary = await collectQuoteResults(options.root ?? 'comparisons');
  const oops = await countOopsPages(options.screenshots ?? 'screenshots', summary);
  const guidList =
    options.guidListPath === undefined || options.mrpAndQuoteOutputDir === undefined
      ? undefined
      : await collectGuidListStatus(options.guidListPath, options.mrpAndQuoteOutputDir, summary);
  printQuoteResultsSummary(summary, oops, guidList);
}

/**
 * Reads each `<root>/<policyDetailsId>-<historyId>` folder; other folders, such as the OCR cache or
 * `run-<timestamp>` reports, are skipped. A folder's `result.json` (written by quote-page) gives its outcome; a folder with
 * only a `report.json`, from a run before results were saved, counts as compared, since a report exists only when
 * both sides were captured.
 * @param root Comparisons folder.
 * @returns The compared, declined, failed and unrecorded policies, each sorted by folder name.
 * @throws When a `result.json` or `report.json` cannot be read or parsed.
 */
export async function collectQuoteResults(root: string): Promise<QuoteResultsSummary> {
  const summary: QuoteResultsSummary = { root: resolve(root), compared: [], declined: [], failed: [], unrecorded: [] };
  const names = (await readDirectories(summary.root)).filter((name) => policyFolderPattern.test(name));
  for (const name of names) {
    const directory = join(summary.root, name);
    const result = await readQuoteResult(directory);
    if (result?.outcome === 'failed') {
      summary.failed.push({ ...result, name });
    } else if (result?.outcome === 'declined') {
      summary.declined.push(name);
    } else {
      const report = await readComparisonReport(join(directory, 'report.json'));
      if (report === undefined) {
        summary.unrecorded.push(name);
      } else {
        summary.compared.push(summariseReport(name, report));
      }
    }
  }

  return summary;
}

/**
 * Counts each flow's saved failure pages (`-nhi-failed.html`, `-tcas-failed.html`) that show the Oops heading, and
 * how many of those policies still compared or declined, for example after NHI retried with a replacement quote GUID.
 * @param screenshots Screenshots folder.
 * @param summary The comparisons summary, to tell which policies recovered.
 * @returns One count for NHI, then one for TCAS.
 * @throws When a failure page cannot be read.
 */
export async function countOopsPages(screenshots: string, summary: QuoteResultsSummary): Promise<OopsCount[]> {
  const folder = resolve(screenshots);
  const recoveredNames = new Set([...summary.compared.map(({ name }) => name), ...summary.declined]);
  const counts: Record<string, OopsCount> = {
    nhi: { flow: 'NHI', total: 0, recovered: 0 },
    tcas: { flow: 'TCAS', total: 0, recovered: 0 }
  };
  for (const file of await readFileNames(folder)) {
    const [, name = '', flow = ''] = failurePagePattern.exec(file) ?? [];
    const count = counts[flow.toLowerCase()];
    if (count !== undefined && oopsHeadingPattern.test(await readFile(join(folder, file), 'utf8'))) {
      count.total++;
      count.recovered += recoveredNames.has(name.toUpperCase()) ? 1 : 0;
    }
  }

  return Object.values(counts);
}

/**
 * Compares the GUID list with the comparisons folders and mrp-and-quote's output folder.
 * @param guidListPath GUID list file, one policy ID per line.
 * @param mrpAndQuoteOutputDir mrp-and-quote's output folder.
 * @param summary The comparisons summary, to tell which listed policies have run.
 * @returns The list's size, its policies with no result, and those whose MRP record was not retrieved.
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
    ...summary.failed.map(({ name }) => name),
    ...summary.unrecorded
  ]);
  return {
    path: resolve(guidListPath),
    total: guids.length,
    notRun: guids.filter((guid) => !names.has(`${guid}-${fetchedHistoryId}`)),
    missingMrp: await filterMissingMrpFiles(guids, mrpAndQuoteOutputDir)
  };
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
 * policy or quote GUIDs, with or without dashes.
 * @param issue One line of a failure message.
 * @returns The issue with those parts replaced by `<url>`, `<path>` and `<id>`.
 */
export function normaliseIssue(issue: string): string {
  return issue
    .replace(/\s*\(https?:\/\/[^)\s]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:\\\S+|(?:\/[\w.-]+){2,}/g, '<path>')
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

interface ComparisonReport {
  dimensions: { before: { width: number; height: number }; after: { width: number; height: number } };
  changedPixels: number;
  changedPercent: number;
  regions: ReportRegion[];
}

function printQuoteResultsSummary(
  summary: QuoteResultsSummary,
  oops: OopsCount[],
  guidList: GuidListStatus | undefined
): void {
  console.log(color.Cyan(`Quote results summary (${summary.root})`));
  printVisualOnlyDifferences(summary.compared.filter(isVisualOnly));
  printTextDifferences(summary.compared.filter((policy) => policy.textDifferences.length > 0));
  printCommonTextChanges(countTextChanges(summary.compared).filter(({ count }) => count > 1));
  printFailedPolicies(summary.failed);
  printFailureReasons(countFailureReasons(summary.failed));
  if (summary.unrecorded.length > 0) {
    console.log(`\n${color.Gray(`Policies without a result: ${summary.unrecorded.join(', ')}`)}`);
  }

  printMissingMrpRecords(guidList?.missingMrp ?? []);
  printTotals(summary, oops, guidList);
}

function printVisualOnlyDifferences(policies: ComparedPolicy[]): void {
  if (policies.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`Visual-only differences (${policies.length})`)}`);
  for (const policy of [...policies].sort((a, b) => b.changedPercent - a.changedPercent)) {
    console.log(`  ${policy.name}  ${describeChange(policy)}`);
  }
}

function printTextDifferences(policies: ComparedPolicy[]): void {
  if (policies.length === 0) {
    return;
  }

  console.log(`\n${color.Cyan(`Text differences (${policies.length})`)}`);
  for (const policy of policies) {
    const regions = policy.textDifferences.length;
    console.log(
      `${policy.name}  ${describeChange(policy)}, ${regions} ${regions === 1 ? 'region' : 'regions'} with text changes`
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
}

function printGuidListTotals(guidList: GuidListStatus | undefined): void {
  if (guidList === undefined) {
    console.log(color.Gray('GUID list skipped: QUOTE_GUID_LIST_PATH and MRP_AND_QUOTE_OUTPUT_DIR are not both set.'));
    return;
  }

  const { path, total, notRun, missingMrp } = guidList;
  const notRetrieved = `${missingMrp.length} MRP records not retrieved`;
  console.log(
    `GUID list: ${total} policies (${path}); ${total - notRun.length} with a result, ${notRun.length} not run; ${
      missingMrp.length > 0 ? color.Yellow(notRetrieved) : notRetrieved
    }.`
  );
}

function isVisualOnly(policy: ComparedPolicy): boolean {
  return policy.changedPixels > 0 && policy.textDifferences.length === 0;
}

function describeChange(policy: ComparedPolicy): string {
  const change = `${policy.changedPercent.toFixed(2)}% changed`;
  return policy.sizeDifference === undefined ? change : `${change}, page sizes differ: ${policy.sizeDifference}`;
}

function describeLines(lines: string[]): string {
  return lines.length === 0 ? '(nothing)' : lines.join(' / ');
}

function summariseReport(name: string, report: ComparisonReport): ComparedPolicy {
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
      .filter((difference) => difference.removed.length + difference.added.length > 0)
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
    lowConfidence: [region.before.confidence, region.after.confidence].some(
      (confidence) => confidence === null || confidence < lowOcrConfidence
    )
  };
}

function textLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readComparisonReport(path: string): Promise<ComparisonReport | undefined> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }

  const report: unknown = JSON.parse(content);
  if (!isComparisonReport(report)) {
    throw new Error(`Comparison report must have dimensions, changedPixels, changedPercent and regions: ${path}`);
  }

  return report;
}

async function readFileNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function readDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
