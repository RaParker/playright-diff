import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
 * Nothing is written when no answer was changed.
 * @param path File to write.
 * @param report The policy and its changes.
 * @returns Whether the file was written.
 * @throws When the folder or file cannot be written.
 */
export async function writeAnswerChanges(path: string, report: AnswerChangesReport): Promise<boolean> {
  const flows = Object.keys(report.changes).sort();
  if (flows.length === 0) {
    return false;
  }

  const changes = Object.fromEntries(flows.map((flow) => [flow, report.changes[flow]]));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...report, changes }, null, 2)}\n`);
  return true;
}
