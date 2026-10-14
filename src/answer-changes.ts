import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { replaceFile } from './fs-helpers.js';

/** File name of the answer changes each quote-page run writes into its `<policyDetailsId>-<historyId>` output folder. */
export const answerChangesFileName = 'answer-changes.json';

/** Question name the cover start fix records its changes under. */
export const coverStartQuestion = 'cover start';

/** A change the flow made to one question's answer, so the journey would accept the test data. */
export interface AnswerChange {
  /** Question changed, e.g. `claim value`. */
  question: string;
  /** Answer shown before the change, or `null` when the question had none. */
  before: string | null;
  /** Answer given; dates and checkbox lists as the page shows them afterwards. */
  after: string;
  /** Error that led to the change, as the error summary reported it. */
  error: string;
}

/** Answer changes by flow (`nhi` or `tcas`), then by section heading, in the order they were made. */
export type AnswerChangesByFlow = Record<string, Record<string, AnswerChange[]>>;

/** Answer changes saved for one policy. */
export interface AnswerChangesReport {
  policyDetailsId: string;
  historyId: number;
  changes: AnswerChangesByFlow;
}

/** The answer changes of the policy whose asynchronous work is running, if any. */
const changeStorage = new AsyncLocalStorage<AnswerChangesByFlow>();

/**
 * Runs a task while {@link recordAnswerChange} adds the changes it (and the asynchronous work it starts) makes to
 * `changes`, so policies running at the same time keep their changes apart.
 * @param changes Changes recorded so far; the task's changes are added to it, even when the task fails.
 * @param task Work that may record changes.
 * @returns The task's result.
 */
export function collectAnswerChanges<T>(changes: AnswerChangesByFlow, task: () => Promise<T>): Promise<T> {
  return changeStorage.run(changes, task);
}

/** An attempt started by {@link startAnswerChangeAttempt}. */
export interface AnswerChangeAttempt<T> {
  /** The attempt's result. */
  result: Promise<T>;
  /** Adds the attempt's changes to those of the task that started it; call once, when the attempt's result is used. */
  keep: () => void;
}

/**
 * Starts a task whose answer changes are kept apart until {@link AnswerChangeAttempt.keep} is called, so an attempt
 * that is replaced (e.g. by a fallback capture) does not report changes the compared screenshots do not reflect.
 * @param task Work that may record changes.
 * @returns The attempt's result, and a function that keeps its changes.
 */
export function startAnswerChangeAttempt<T>(task: () => Promise<T>): AnswerChangeAttempt<T> {
  const parent = changeStorage.getStore();
  const changes: AnswerChangesByFlow = {};
  return {
    result: changeStorage.run(changes, task),
    keep: () => {
      if (parent === undefined) {
        return;
      }

      for (const [flow, sections] of Object.entries(changes)) {
        for (const [section, sectionChanges] of Object.entries(sections)) {
          ((parent[flow] ??= {})[section] ??= []).push(...sectionChanges);
        }
      }
    }
  };
}

/**
 * Records a change to a question's answer for the {@link collectAnswerChanges} task running it; does nothing outside
 * one.
 * @param flow Flow name (e.g. `NHI` or `TCAS`), recorded in lower case.
 * @param section Section heading holding the question.
 * @param change The change made.
 */
export function recordAnswerChange(flow: string, section: string, change: AnswerChange): void {
  const changes = changeStorage.getStore();
  if (changes === undefined) {
    return;
  }

  const sections = (changes[flow.toLowerCase()] ??= {});
  (sections[section] ??= []).push(change);
}

/**
 * Writes a policy's answer changes as JSON, flows in name order (`nhi` before `tcas`), creating its folder if needed.
 * When no answer was changed, nothing is written and any file a previous run left is removed, so it cannot be read as
 * this run's changes.
 * @param path File to write.
 * @param report The policy and its changes.
 * @returns Whether the file was written.
 * @throws When the folder or file cannot be written, or a previous file cannot be removed.
 */
export async function writeAnswerChanges(path: string, report: AnswerChangesReport): Promise<boolean> {
  const flows = Object.keys(report.changes).sort();
  if (flows.length === 0) {
    await rm(path, { force: true });
    return false;
  }

  const changes = Object.fromEntries(flows.map((flow) => [flow, report.changes[flow]]));
  await mkdir(dirname(path), { recursive: true });
  await replaceFile(path, `${JSON.stringify({ ...report, changes }, null, 2)}\n`);
  return true;
}
