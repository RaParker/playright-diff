import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { flowOutputPaths, type FlowName } from './flow-output.js';
import { isMissing, parseJson, readDirectoryNames, readFileNames, readOptionalTextFile } from './fs-helpers.js';
import { policyFolderPattern } from './output-paths.js';
import { describeEndpoints, type ComparisonKind, type QuoteEndpoints } from './quote-endpoint.js';
import {
  describeCoverTypeRecheck,
  summarisePolicyFolder,
  type ComparedPolicy,
  type PolicyFolderSummary
} from './summarise.js';

/** How the viewer lists a policy: the summary's comparison kind, or why it has no comparison. */
export type ViewerPolicyKind = ComparisonKind | 'failed' | 'declined' | 'unrecorded';

/** One policy in the viewer's list. */
export interface ViewerPolicy {
  /** Its `<policyDetailsId>-<historyId>` folder name. */
  name: string;
  kind: ViewerPolicyKind;
  changedPercent?: number;
  /** For example `1440×7565 vs 1440×7600`, when the screenshots differ in size. */
  sizeDifference?: string;
  hasTextDifferences: boolean;
  /** Where each flow ended, as the summary words it, or `NHI and TCAS both quoted`; unset when not recorded. */
  endpoints?: string;
  /** The Buildings & Contents re-check, as the summary words it (see {@link describeCoverTypeRecheck}). */
  coverTypeRecheck?: string;
}

/** The run the viewer shows: its output folder and every policy in it, in folder order. */
export interface ViewerRun {
  root: string;
  runName?: string;
  environment?: string;
  policies: ViewerPolicy[];
}

/** A changed region of a compared policy, with its OCR text change (empty when the text is the same). */
export interface ViewerRegion {
  id: number;
  /** In the screenshots' own pixels. */
  bounds: { left: number; top: number; width: number; height: number };
  removed: string[];
  added: string[];
  lowConfidence: boolean;
}

/** The files the viewer can show for a policy, by role; each is a file name in its folder, set only when it exists. */
export interface ViewerImages {
  nhi?: string;
  mrp?: string;
  diff?: string;
  failedNhi?: string;
  failedMrp?: string;
}

/** Everything the viewer shows for one policy. */
export interface ViewerPolicyDetail extends ViewerPolicy {
  imageScale?: number;
  images: ViewerImages;
  regions: ViewerRegion[];
  /** The failure message from `result.json`, one line per entry. */
  issues: string[];
  /** The policy's `answer-changes.json`, as saved. */
  answerChanges?: unknown;
  endorsementOrderDiffers: boolean;
}

/** The parts of `report.json` the viewer reads beyond what the summary does. */
interface RawReport {
  before?: unknown;
  after?: unknown;
  imageScale?: unknown;
  regions?: { id: number; bounds: ViewerRegion['bounds'] }[];
}

/**
 * Lists every policy in an output folder as the summary counts it.
 * @param root Folder holding the policy folders.
 * @param run The run's name and environment, shown in the viewer's header.
 * @returns The run, with its policies in folder order.
 * @throws When a policy's `result.json` or `report.json` cannot be read or parsed.
 */
export async function listViewerPolicies(
  root: string,
  run: { runName?: string; environment?: string }
): Promise<ViewerRun> {
  const folder = resolve(root);
  const names = (await readDirectoryNames(folder)).filter((name) => policyFolderPattern.test(name)).sort();
  const summaries = await Promise.all(names.map((name) => summarisePolicyFolder(folder, name)));
  return {
    root: folder,
    ...run,
    policies: names.map((name, index) => toViewerPolicy(name, summaries[index]))
  };
}

/**
 * Reads what the viewer shows for one policy folder.
 * @param root Folder holding the policy folders.
 * @param folder The policy's folder name; anything that is not a policy folder in `root` gives `undefined`.
 * @returns The policy's detail, or `undefined` when there is no such policy folder.
 * @throws When its `result.json`, `report.json` or `answer-changes.json` cannot be read or parsed.
 */
export async function readViewerPolicyDetail(root: string, folder: string): Promise<ViewerPolicyDetail | undefined> {
  const directory = join(resolve(root), folder);
  if (!policyFolderPattern.test(folder) || !(await isDirectory(directory))) {
    return undefined;
  }

  const [summary, files, report, answerChanges] = await Promise.all([
    summarisePolicyFolder(resolve(root), folder),
    readFileNames(directory),
    readJsonFile(join(directory, 'report.json')),
    readJsonFile(join(directory, 'answer-changes.json'))
  ]);
  const raw = (report ?? {}) as RawReport;
  const compared = summary.status === 'compared' ? summary.policy : undefined;
  return {
    ...toViewerPolicy(folder, summary),
    ...(typeof raw.imageScale === 'number' ? { imageScale: raw.imageScale } : {}),
    images: findImages(directory, new Set(files), raw),
    regions: compared === undefined ? [] : readRegions(raw, compared),
    issues: summary.result?.issues ?? [],
    ...(answerChanges === undefined ? {} : { answerChanges }),
    endorsementOrderDiffers: compared?.endorsementOrderDiffers ?? false
  };
}

function toViewerPolicy(name: string, summary: PolicyFolderSummary | undefined): ViewerPolicy {
  if (summary?.status !== 'compared') {
    return { name, kind: summary?.status ?? 'unrecorded', hasTextDifferences: false };
  }

  const { policy } = summary;
  const endpoints = describeViewerEndpoints(policy.endpoints);
  return {
    name,
    kind: policy.kind,
    changedPercent: policy.changedPercent,
    ...(policy.sizeDifference === undefined ? {} : { sizeDifference: policy.sizeDifference }),
    hasTextDifferences: policy.textDifferences.length > 0,
    ...(endpoints === undefined ? {} : { endpoints }),
    ...(policy.coverTypeRecheck === undefined
      ? {}
      : { coverTypeRecheck: describeCoverTypeRecheck(policy.coverTypeRecheck) })
  };
}

/**
 * Finds the screenshots in a policy folder. The compared pair are the files `report.json` names (a decline saves
 * `screenshot-declined-*.png`), falling back to the quote page screenshots.
 */
function findImages(directory: string, files: Set<string>, report: RawReport): ViewerImages {
  const present = (path: unknown): string | undefined => {
    const name = typeof path === 'string' ? basename(path) : undefined;
    return name !== undefined && files.has(name) ? name : undefined;
  };

  const flow = (name: FlowName) => flowOutputPaths(directory, name);
  const images: ViewerImages = {
    nhi: present(report.before) ?? present(flow('nhi').screenshot),
    mrp: present(report.after) ?? present(flow('mrp').screenshot),
    diff: present('diff.png'),
    failedNhi: present(flow('nhi').stopped.failed.screenshot),
    failedMrp: present(flow('mrp').stopped.failed.screenshot)
  };
  return Object.fromEntries(Object.entries(images).filter(([, value]) => value !== undefined));
}

/** Each region of `report.json` with the summary's line-by-line text change for it. */
function readRegions(report: RawReport, policy: ComparedPolicy): ViewerRegion[] {
  return (report.regions ?? []).map(({ id, bounds }) => {
    const difference = policy.textDifferences.find(({ regionId }) => regionId === id);
    return {
      id,
      bounds,
      removed: difference?.removed ?? [],
      added: difference?.added ?? [],
      lowConfidence: difference?.lowConfidence ?? false
    };
  });
}

/** The summary's wording of where the flows ended, which it leaves out when both quoted; the viewer says so. */
function describeViewerEndpoints(endpoints: QuoteEndpoints | undefined): string | undefined {
  return describeEndpoints(endpoints) ?? (endpoints === undefined ? undefined : 'NHI and TCAS both quoted');
}

async function readJsonFile(path: string): Promise<unknown> {
  const content = await readOptionalTextFile(path);
  return content === undefined ? undefined : parseJson(content, path);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }
}
